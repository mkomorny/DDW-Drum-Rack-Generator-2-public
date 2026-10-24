// v1.1.0 Max for Live bridge — Electron-side client.
//
// Direction of flow: the M4L device (Node for Max, m4l/ddw-bridge.js) hosts
// a small HTTP server bound to 127.0.0.1 and writes a handshake file
// describing it; this app only ever reads that file and makes outgoing
// requests. There's no server here and nothing listens on any port on the
// Electron side — see docs/IMPLEMENTATION_PLAN.md's v1.1.0 entry for why.
//
// A stale handshake file (the device was removed, or Live crashed without
// cleaning up) is treated as "not connected", not as an error — see
// isStale below. The renderer polls status() on a timer; send() is only
// ever called right before a real "Send to Rack" click.
const fs = require('fs');
const http = require('http');

const REQUEST_TIMEOUT_MS = 4000;

function readHandshake(handshakePath) {
  let raw;
  try {
    raw = fs.readFileSync(handshakePath, 'utf8');
  } catch {
    return null; // no device loaded, or nothing written yet
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data.port !== 'number' || typeof data.token !== 'string') return null;
    return data;
  } catch {
    return null; // mid-write or corrupt — treat the same as absent
  }
}

// A dead pid means the Live process that wrote this file is gone (crash,
// force-quit) without deleting it on unload as the normal path does.
// process.kill(pid, 0) sends no signal, just probes existence, and works
// the same way on Windows as on POSIX per Node's own docs.
function isPidAlive(pid) {
  if (typeof pid !== 'number') return true; // unknown shape — don't assume stale
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requestJson(method, handshake, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port: handshake.port,
      path: urlPath,
      method,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'X-DDW-Token': handshake.token,
        ...(payload != null ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`bridge responded ${res.statusCode}`));
          return;
        }
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('bridge request timed out')));
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

// Returns { connected: false } when there's no device, a dead one, or it
// didn't answer — never throws, since this is polled continuously by the
// renderer just to drive a status indicator.
async function status(handshakePath) {
  const handshake = readHandshake(handshakePath);
  if (!handshake || !isPidAlive(handshake.pid)) return { connected: false };
  try {
    const body = await requestJson('GET', handshake, '/status');
    return { connected: true, trackName: handshake.trackName, rackName: handshake.rackName, ...body };
  } catch {
    return { connected: false };
  }
}

// resolvedPads: the same shape resolvePads() produces — [{ note, samplePath, ... }].
// An unfilled pad (samplePath: null, as of v1.1.1) is left out of the
// request entirely rather than sent as some kind of "clear" instruction —
// the corresponding Live pad just keeps whatever sample it already has.
// Returns { ok: true, results } or { ok: false, reason, detail }.
async function send(handshakePath, resolvedPads) {
  const handshake = readHandshake(handshakePath);
  if (!handshake || !isPidAlive(handshake.pid)) {
    return { ok: false, reason: 'not-connected' };
  }
  try {
    const body = await requestJson('POST', handshake, '/load', {
      pads: resolvedPads.filter(p => p.samplePath).map(p => ({ note: p.note, path: p.samplePath }))
    });
    // ddw-live.js can report a whole-request failure (e.g. the Drum Rack was
    // removed between the last status poll and this send) as well as
    // per-pad failures inside a successful request — the whole-request case
    // is treated as send() failing outright, same as a network error.
    if (body.ok === false) return { ok: false, reason: body.reason || 'send-failed', detail: body.detail };
    return { ok: true, results: body.results || [] };
  } catch (err) {
    return { ok: false, reason: 'send-failed', detail: err.message };
  }
}

module.exports = { status, send, readHandshake, isPidAlive };
