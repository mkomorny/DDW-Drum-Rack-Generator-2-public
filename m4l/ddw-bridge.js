// DDW Drum Rack Generator — v1.1.0 Max for Live bridge, Node for Max half.
// Runs inside a `node.script ddw-bridge.js` object. Node for Max can't touch
// the Live API at all (only a `v8` object in the same patcher can — see
// ddw-live.js) so this file's only jobs are: host the HTTP server Electron
// talks to, own the handshake file's lifecycle, correlate each HTTP request
// with the matching reply from ddw-live.js over the patch cords between the
// two objects, and (best-effort) launch/focus the DDW app itself.
//
// Wire-format on the patch cords connecting this object to ddw-live.js's v8
// object (outlet 0 -> v8 inlet 0, v8 outlet 0 -> this object's inlet 0):
// every message in both directions starts with a request id so a reply can
// always be matched back to the HTTP request that caused it, even if two
// arrive close together — see docs/IMPLEMENTATION_PLAN.md's v1.1.0 entry.
//   -> ["status", reqId]                  <- ["status_result", reqId, json]
//   -> ["load", reqId, jsonPadsString]     <- ["load_result", reqId, json]
const Max = require('max-api'); // Node for Max's bridge to the patcher — bundled, not an npm install
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const HANDSHAKE_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'DDW Drum Rack Generator');
const HANDSHAKE_PATH = path.join(HANDSHAKE_DIR, 'bridge.json');
const PORT_RANGE_START = 17640;
const PORT_RANGE_SPAN = 8; // tries 17640..17647 before giving up
const V8_REPLY_TIMEOUT_MS = 3000;

const token = crypto.randomBytes(16).toString('hex');
let nextReqId = 1;
const pending = new Map(); // reqId -> { resolve, timer }

function replyFromPatch(kind, reqId, json) {
  const entry = pending.get(reqId);
  if (!entry) return; // timed out already, or a stray/duplicate reply
  pending.delete(reqId);
  clearTimeout(entry.timer);
  try {
    entry.resolve(JSON.parse(json));
  } catch (err) {
    entry.reject(new Error('bad JSON from ddw-live.js: ' + err.message));
  }
}

Max.addHandler('status_result', (reqId, json) => replyFromPatch('status', reqId, json));
Max.addHandler('load_result', (reqId, json) => replyFromPatch('load', reqId, json));

// Sends a request into the patch and returns a promise that resolves with
// whatever ddw-live.js sends back tagged with the same id, or rejects if it
// never answers — a dropped message shouldn't hang an HTTP request forever
// (see the v8-init-timing note in m4l/spike/README.md; steady-state traffic
// like this shouldn't hit that race, but the timeout is cheap insurance).
function askPatch(verb, ...args) {
  const reqId = nextReqId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('ddw-live.js did not respond in time'));
    }, V8_REPLY_TIMEOUT_MS);
    pending.set(reqId, { resolve, reject, timer });
    Max.outlet(verb, reqId, ...args);
  });
}

// ---- Handshake file lifecycle ----

let lastKnownStatus = { trackName: null, rackName: null, padsReady: 0 };

function writeHandshake(port) {
  fs.mkdirSync(HANDSHAKE_DIR, { recursive: true });
  fs.writeFileSync(HANDSHAKE_PATH, JSON.stringify({
    port, token, pid: process.pid,
    trackName: lastKnownStatus.trackName,
    rackName: lastKnownStatus.rackName,
    padsReady: lastKnownStatus.padsReady
  }));
}

function deleteHandshake() {
  try { fs.unlinkSync(HANDSHAKE_PATH); } catch { /* already gone */ }
}

// ---- Launching/focusing the standalone app ----
//
// Best-effort only — Send to Rack itself only needs the HTTP server below,
// which works whether or not DDW.exe was launched from here. This guesses
// the default per-user install path electron-builder's NSIS target produces
// for this app's package.json (perMachine: false, no custom installDir), so
// it's a real, grounded guess rather than an invented path — see
// docs/IMPLEMENTATION_PLAN.md's v1.1.0 entry.
function findDdwExe() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const candidate = path.join(localAppData, 'Programs', 'DDW Drum Rack Generator', 'DDW Drum Rack Generator.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

function openDdw() {
  const exePath = findDdwExe();
  if (!exePath) {
    Max.post('DDW bridge: could not find DDW Drum Rack Generator.exe in the default install location — open it manually.');
    return { ok: false, reason: 'not-found' };
  }
  try {
    spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  } catch (err) {
    Max.post('DDW bridge: failed to launch DDW.exe — ' + err.message);
    return { ok: false, reason: 'spawn-failed', detail: err.message };
  }
}

Max.addHandler('open_ddw', () => openDdw());

// ---- HTTP server ----

function requireToken(req, res) {
  if (req.headers['x-ddw-token'] !== token) {
    res.writeHead(401).end();
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!requireToken(req, res)) return;
  try {
    if (req.method === 'GET' && req.url === '/status') {
      const result = await askPatch('status');
      // Piggyback the handshake file's refresh on every real status check
      // (Electron polls this every few seconds) rather than a separate
      // Live-API-observer-driven push path — one less thing that can drift
      // out of sync or silently stop firing.
      lastKnownStatus = result;
      writeHandshake(server.address().port);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      return;
    }
    if (req.method === 'POST' && req.url === '/load') {
      const body = await readBody(req);
      const { pads } = JSON.parse(body);
      const result = await askPatch('load', JSON.stringify(pads));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      return;
    }
    res.writeHead(404).end();
  } catch (err) {
    res.writeHead(504, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
  }
});

function tryListen(portOffset) {
  if (portOffset >= PORT_RANGE_SPAN) {
    Max.post('DDW bridge: no free port found in ' + PORT_RANGE_START + '-' + (PORT_RANGE_START + PORT_RANGE_SPAN - 1) + ' — bridge disabled.');
    return;
  }
  const port = PORT_RANGE_START + portOffset;
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') tryListen(portOffset + 1);
    else Max.post('DDW bridge: server error — ' + err.message);
  });
  server.listen(port, '127.0.0.1', () => {
    writeHandshake(port);
    Max.post('DDW bridge: listening on 127.0.0.1:' + port);
  });
}

tryListen(0);

// Best-effort cleanup — see client.js's isPidAlive: a bridge.json whose pid
// is no longer running is already treated as "not connected" even if this
// never runs (a Live crash, e.g.), so this isn't load-bearing, just tidy.
process.on('exit', deleteHandshake);
