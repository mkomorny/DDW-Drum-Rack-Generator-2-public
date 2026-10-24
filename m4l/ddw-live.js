// DDW Drum Rack Generator — v1.1.0 Max for Live bridge, v8/Live-API half.
// Runs inside a `v8 ddw-live.js` object. Node for Max (ddw-bridge.js, wired
// into this object's inlet 0) can't touch the Live API at all — every
// LiveAPI call in this whole device happens in this file. See
// m4l/spike/replace-sample-test.js for the proven single-pad version this
// generalizes from (idListToIds, the this_device -> track -> DrumGroupDevice
// walk, and the OriginalSimpler check are all unchanged).
//
// Dispatch: Max calls the JS function whose name matches a message's first
// atom, same as the spike's bang(). Both entry points here take a reqId
// first so ddw-bridge.js can match the reply to the HTTP request that
// caused it (see that file's askPatch/pending map).
//   status(reqId)             -> outlet: "status_result" reqId json
//   load(reqId, jsonPadsStr)  -> outlet: "load_result"   reqId json

autowatch = 1;
inlets = 1;
outlets = 1;

// Matches PAD_DATA in src/renderer.js: 16 pads, notes 36 (C1) - 51 (D#2).
var MIN_NOTE = 36;
var MAX_NOTE = 51;

function idListToIds(propArray) {
  var ids = [];
  for (var i = 0; i < propArray.length; i += 2) {
    if (propArray[i] === 'id') ids.push(propArray[i + 1]);
  }
  return ids;
}

function findDrumRack() {
  var track = new LiveAPI('this_device canonical_parent');
  if (!track || track.id === 0) return { track: null, rack: null };
  var deviceIds = idListToIds(track.get('devices'));
  for (var i = 0; i < deviceIds.length; i++) {
    var dev = new LiveAPI('id ' + deviceIds[i]);
    if (dev.get('class_name')[0] === 'DrumGroupDevice') {
      return { track: track, rack: new LiveAPI('id ' + deviceIds[i]) };
    }
  }
  return { track: track, rack: null };
}

// Returns the pad's populated Simpler as a LiveAPI, or null with a reason
// ('no-pad' | 'empty-chain' | 'not-simpler') when it isn't one.
function simplerForNote(rack, note) {
  var padIds = idListToIds(rack.get('drum_pads'));
  for (var i = 0; i < padIds.length; i++) {
    var pad = new LiveAPI('id ' + padIds[i]);
    if (pad.get('note')[0] !== note) continue;
    var chainIds = idListToIds(pad.get('chains'));
    if (chainIds.length === 0) return { simpler: null, reason: 'empty-chain' };
    var chain = new LiveAPI('id ' + chainIds[0]);
    var chainDeviceIds = idListToIds(chain.get('devices'));
    if (chainDeviceIds.length === 0) return { simpler: null, reason: 'empty-chain' };
    var device = new LiveAPI('id ' + chainDeviceIds[0]);
    if (device.get('class_name')[0] !== 'OriginalSimpler') return { simpler: null, reason: 'not-simpler' };
    return { simpler: device, reason: null };
  }
  return { simpler: null, reason: 'no-pad' };
}

// Best-effort — get_major_version/get_minor_version on live_app answer
// synchronously in every documented example this was modeled on (unlike
// most LiveAPI.call() results), but this is defensive, not proven on this
// specific Live build the way replace_sample itself was in the Phase 0
// spike, so a failure here degrades to "unknown" rather than blocking.
function liveVersionOk() {
  try {
    var app = new LiveAPI('live_app');
    var major = app.call('get_major_version');
    var minor = app.call('get_minor_version');
    if (typeof major !== 'number') return null;
    return major > 12 || (major === 12 && minor >= 4);
  } catch (e) {
    return null;
  }
}

function computeStatus() {
  var found = findDrumRack();
  if (!found.track) {
    return { ok: false, reason: 'no-track', trackName: null, rackName: null, padsReady: 0, liveVersionOk: liveVersionOk() };
  }
  var trackName = found.track.get('name')[0];
  if (!found.rack) {
    return { ok: false, reason: 'no-drum-rack', trackName: trackName, rackName: null, padsReady: 0, liveVersionOk: liveVersionOk() };
  }
  var rackName = found.rack.get('name')[0];
  var padsReady = 0;
  for (var note = MIN_NOTE; note <= MAX_NOTE; note++) {
    if (simplerForNote(found.rack, note).simpler) padsReady++;
  }
  return { ok: true, trackName: trackName, rackName: rackName, padsReady: padsReady, liveVersionOk: liveVersionOk() };
}

function status(reqId) {
  try {
    outlet(0, 'status_result', reqId, JSON.stringify(computeStatus()));
  } catch (e) {
    outlet(0, 'status_result', reqId, JSON.stringify({ ok: false, reason: 'exception', detail: e.toString() }));
  }
}

// pads: [{ note, path }, ...]. Every pad is attempted even if an earlier one
// fails — a bad path on one pad shouldn't block the other 15 from loading,
// and the per-note result list is how the renderer would eventually surface
// a partial failure rather than a silent one.
function load(reqId, jsonPadsStr) {
  var results = [];
  try {
    var found = findDrumRack();
    if (!found.rack) {
      outlet(0, 'load_result', reqId, JSON.stringify({ ok: false, reason: 'no-drum-rack' }));
      return;
    }
    var pads = JSON.parse(jsonPadsStr);
    for (var i = 0; i < pads.length; i++) {
      var note = pads[i].note;
      var lookup = simplerForNote(found.rack, note);
      if (!lookup.simpler) {
        results.push({ note: note, ok: false, reason: lookup.reason });
        continue;
      }
      try {
        lookup.simpler.call('replace_sample', pads[i].path);
        results.push({ note: note, ok: true });
      } catch (e) {
        results.push({ note: note, ok: false, reason: 'replace-failed', detail: e.toString() });
      }
    }
    outlet(0, 'load_result', reqId, JSON.stringify({ ok: true, results: results }));
  } catch (e) {
    outlet(0, 'load_result', reqId, JSON.stringify({ ok: false, reason: 'exception', detail: e.toString() }));
  }
}
