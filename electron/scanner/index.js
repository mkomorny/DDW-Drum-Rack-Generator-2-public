const { walkAudioFiles } = require('./walk');
const { parseAudioHeader } = require('./audioHeaders');
const db = require('../db');

const BATCH_SIZE = 200;
const PROGRESS_EVERY = 50;

// Scans one pack folder and reconciles the DB against what's on disk.
// Incremental: a file whose (mtimeMs, size) match the last-indexed values
// is assumed unchanged and its header is not re-parsed — only new or
// modified files pay the parse cost. Files that disappeared from disk since
// the last scan are removed from the index at the end.
async function scanPack(pack, onProgress) {
  const existing = db.getPackFileMap(pack.id);
  const seen = new Set();
  const stats = { scanned: 0, added: 0, updated: 0, unchanged: 0, unreadable: 0 };
  let batch = [];

  for await (const file of walkAudioFiles(pack.path)) {
    seen.add(file.path);
    const prev = existing.get(file.path);

    if (prev && prev.mtimeMs === file.mtimeMs && prev.size === file.size) {
      stats.unchanged++;
    } else {
      const header = parseAudioHeader(file.path, file.ext);
      if (header) {
        batch.push({
          path: file.path,
          filename: file.name,
          ext: file.ext.toLowerCase(),
          size: file.size,
          mtimeMs: file.mtimeMs,
          durationMs: header.durationMs,
          sampleRate: header.sampleRate,
          channels: header.channels,
          bitDepth: header.bitDepth
        });
        prev ? stats.updated++ : stats.added++;
      } else {
        stats.unreadable++;
      }
    }

    stats.scanned++;
    if (batch.length >= BATCH_SIZE) {
      db.upsertSamples(pack.id, batch);
      batch = [];
    }
    if (stats.scanned % PROGRESS_EVERY === 0) {
      onProgress?.({ packId: pack.id, packPath: pack.path, currentPath: file.path, ...stats });
      await new Promise(resolve => setImmediate(resolve)); // yield to the event loop
    }
  }

  if (batch.length) db.upsertSamples(pack.id, batch);
  stats.removed = db.deleteSamplesNotIn(pack.id, seen);

  onProgress?.({ packId: pack.id, packPath: pack.path, currentPath: null, ...stats, done: true });
  return stats;
}

module.exports = { scanPack };
