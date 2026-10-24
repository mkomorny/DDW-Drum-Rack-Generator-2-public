// Shared pad-resolution step for both output paths (.adg export, v1.1.0's
// Max for Live "Send to Rack" bridge): turns each pad's sampleId into the
// real absolute path + audio metadata the .adg writer needs, or a note
// number + path pair the bridge needs — a shared step so the two outputs can
// never disagree about what a pad resolves to. Extracted from the body of
// the export:adg IPC handler (electron/main.js), unchanged in behavior.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { parseAudioHeader } = require('../scanner/audioHeaders');

// pads: [{ note, sampleId }, ...] (any extra fields are ignored). A pad with
// no sampleId (an unfilled pad — see v1.1.1's "export doesn't need every pad
// filled" change) resolves to samplePath: null rather than being looked up;
// callers (adg.js, the Live bridge) each decide what an unfilled pad means
// for their own output.
// Returns { ok: true, resolved } or { ok: false, reason, detail }, matching
// the reason codes electron/main.js's export:adg handler already returns to
// the renderer (see EXPORT_FAILURE_MESSAGES in src/renderer.js).
function resolvePads(pads) {
  const resolved = [];
  for (const pad of pads) {
    if (pad.sampleId == null) {
      resolved.push({ note: pad.note, samplePath: null });
      continue;
    }
    const row = db.getSampleById(pad.sampleId);
    if (!row || !fs.existsSync(row.path)) {
      return { ok: false, reason: 'missing-sample', detail: row ? row.path : String(pad.sampleId) };
    }
    let durationMs = row.duration_ms;
    let sampleRate = row.sample_rate;
    if (durationMs == null || sampleRate == null) {
      const header = parseAudioHeader(row.path, row.ext);
      if (!header) return { ok: false, reason: 'unreadable-sample', detail: row.path };
      durationMs = header.durationMs;
      sampleRate = header.sampleRate;
    }
    resolved.push({
      note: pad.note,
      samplePath: row.path,
      sampleName: path.parse(row.filename).name,
      durationMs, sampleRate,
      fileSize: row.size,
      mtimeSec: Math.floor(row.mtime_ms / 1000)
    });
  }
  return { ok: true, resolved };
}

module.exports = { resolvePads };
