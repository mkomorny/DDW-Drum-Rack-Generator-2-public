const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { app } = require('electron');
const { DEFAULT_CATEGORIES } = require('../classify/categories');
const { TYPE_DEFS } = require('../classify/typeCategories');

// The library index lives in Electron's userData directory, not the project
// folder: it's a generated, machine-specific cache of the user's local
// sample library (paths, sizes, parsed durations), not project source or a
// secret. Keeping it outside the repo means there's nothing to gitignore
// and nothing that can ever accidentally get staged.
//
// Uses Node's built-in `node:sqlite` (stable in the Node 24 that Electron 43
// bundles) rather than better-sqlite3: this machine has no Visual Studio
// Build Tools, so a native addon requiring node-gyp compilation against
// Electron's ABI can't be built here without an invasive multi-GB toolchain
// install. node:sqlite ships with the runtime — zero native compilation,
// zero packaging risk later in v1.0.0.

let db = null;

function getDb() {
  if (db) return db;
  const dbPath = path.join(app.getPath('userData'), 'library.db');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      duration_ms REAL,
      sample_rate INTEGER,
      channels INTEGER,
      bit_depth INTEGER,
      scanned_at INTEGER NOT NULL,
      category_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_samples_pack ON samples(pack_id);
    CREATE TABLE IF NOT EXISTS category_rules (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      aliases TEXT NOT NULL,
      max_len_ms INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS type_cutoffs (
      type_id TEXT PRIMARY KEY,
      cutoff_value INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  ensureCategoryColumn(db); // v0.2.0 databases predate the samples.category_id column
  ensureTypeColumns(db); // v0.3.0 databases predate samples.type_id/subcategory_id
  seedDefaultCategoryRules(db);
  seedDefaultTypeCutoffs(db);
  return db;
}

// Idempotent migration for databases created before v0.3.0, which had no
// samples.category_id column (the CREATE TABLE above only covers fresh
// installs — IF NOT EXISTS skips existing tables entirely).
function ensureCategoryColumn(database) {
  const cols = database.prepare('PRAGMA table_info(samples)').all();
  if (!cols.some(c => c.name === 'category_id')) {
    database.exec('ALTER TABLE samples ADD COLUMN category_id TEXT');
  }
}

function seedDefaultCategoryRules(database) {
  const { n } = database.prepare('SELECT COUNT(*) AS n FROM category_rules').get();
  if (n > 0) return;
  const insert = database.prepare(`
    INSERT INTO category_rules (id, label, aliases, max_len_ms, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  database.exec('BEGIN');
  DEFAULT_CATEGORIES.forEach((cat, idx) => {
    insert.run(cat.id, cat.label, JSON.stringify(cat.aliases), cat.maxLenMs, idx);
  });
  database.exec('COMMIT');
}

// Idempotent migration for databases created before v0.4.0, which had no
// samples.type_id/subcategory_id columns.
function ensureTypeColumns(database) {
  const cols = database.prepare('PRAGMA table_info(samples)').all();
  if (!cols.some(c => c.name === 'type_id')) {
    database.exec('ALTER TABLE samples ADD COLUMN type_id TEXT');
  }
  if (!cols.some(c => c.name === 'subcategory_id')) {
    database.exec('ALTER TABLE samples ADD COLUMN subcategory_id TEXT');
  }
}

function seedDefaultTypeCutoffs(database) {
  const { n } = database.prepare('SELECT COUNT(*) AS n FROM type_cutoffs').get();
  if (n > 0) return;
  const insert = database.prepare('INSERT INTO type_cutoffs (type_id, cutoff_value) VALUES (?, ?)');
  database.exec('BEGIN');
  TYPE_DEFS.forEach(def => insert.run(def.id, def.defaultCutoff));
  database.exec('COMMIT');
}

function listPacks() {
  return getDb().prepare(`
    SELECT p.id, p.path, p.added_at AS addedAt, COUNT(s.id) AS sampleCount
    FROM packs p LEFT JOIN samples s ON s.pack_id = p.id
    GROUP BY p.id ORDER BY p.added_at ASC
  `).all();
}

function findPackByPath(packPath) {
  return getDb().prepare('SELECT id, path, added_at AS addedAt FROM packs WHERE path = ?').get(packPath) || null;
}

function addPack(packPath) {
  getDb().prepare('INSERT OR IGNORE INTO packs (path, added_at) VALUES (?, ?)').run(packPath, Date.now());
  return findPackByPath(packPath);
}

function removePack(id) {
  getDb().prepare('DELETE FROM packs WHERE id = ?').run(id);
}

// Map of path -> {mtimeMs, size} for every sample already indexed under this
// pack, used by the scanner to skip re-parsing headers for unchanged files.
function getPackFileMap(packId) {
  const rows = getDb().prepare('SELECT path, mtime_ms AS mtimeMs, size FROM samples WHERE pack_id = ?').all(packId);
  const map = new Map();
  for (const r of rows) map.set(r.path, { mtimeMs: r.mtimeMs, size: r.size });
  return map;
}

function upsertSamples(packId, rows) {
  if (!rows.length) return;
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO samples (pack_id, path, filename, ext, size, mtime_ms, duration_ms, sample_rate, channels, bit_depth, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      pack_id=excluded.pack_id, filename=excluded.filename, ext=excluded.ext, size=excluded.size,
      mtime_ms=excluded.mtime_ms, duration_ms=excluded.duration_ms, sample_rate=excluded.sample_rate,
      channels=excluded.channels, bit_depth=excluded.bit_depth, scanned_at=excluded.scanned_at
  `);
  database.exec('BEGIN');
  try {
    const scannedAt = Date.now();
    for (const r of rows) {
      stmt.run(
        packId, r.path, r.filename, r.ext, r.size, r.mtimeMs,
        r.durationMs ?? null, r.sampleRate ?? null, r.channels ?? null, r.bitDepth ?? null,
        scannedAt
      );
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

// Removes samples that belong to this pack but weren't seen in the most
// recent walk (i.e. the file was deleted/moved on disk since last scan).
function deleteSamplesNotIn(packId, keepPaths) {
  const database = getDb();
  const existing = database.prepare('SELECT path FROM samples WHERE pack_id = ?').all(packId);
  const toDelete = existing.filter(r => !keepPaths.has(r.path)).map(r => r.path);
  if (!toDelete.length) return 0;
  const stmt = database.prepare('DELETE FROM samples WHERE path = ?');
  database.exec('BEGIN');
  for (const p of toDelete) stmt.run(p);
  database.exec('COMMIT');
  return toDelete.length;
}

// ---- Category rules (Rules tab) ----

function listCategoryRules() {
  const rows = getDb().prepare(`
    SELECT id, label, aliases, max_len_ms AS maxLenMs, sort_order AS sortOrder
    FROM category_rules ORDER BY sort_order ASC
  `).all();
  return rows.map(r => ({ ...r, aliases: JSON.parse(r.aliases) }));
}

function updateCategoryRule(id, { aliases, maxLenMs } = {}) {
  const database = getDb();
  if (aliases !== undefined) {
    database.prepare('UPDATE category_rules SET aliases = ? WHERE id = ?').run(JSON.stringify(aliases), id);
  }
  if (maxLenMs !== undefined) {
    database.prepare('UPDATE category_rules SET max_len_ms = ? WHERE id = ?').run(maxLenMs, id);
  }
}

function resetCategoryRule(id) {
  const def = DEFAULT_CATEGORIES.find(c => c.id === id);
  if (!def) return;
  getDb().prepare('UPDATE category_rules SET aliases = ?, max_len_ms = ? WHERE id = ?')
    .run(JSON.stringify(def.aliases), def.maxLenMs, id);
}

function resetAllCategoryRules() {
  DEFAULT_CATEGORIES.forEach(def => resetCategoryRule(def.id));
}

// ---- Sample categorization (electron/classify) ----

function getSamplesForCategorization({ onlyUncategorized } = {}) {
  const where = onlyUncategorized ? 'WHERE category_id IS NULL' : '';
  return getDb().prepare(`SELECT id, path FROM samples ${where}`).all();
}

function setSampleCategories(rows) {
  if (!rows.length) return;
  const database = getDb();
  const stmt = database.prepare('UPDATE samples SET category_id = ? WHERE id = ?');
  database.exec('BEGIN');
  try {
    for (const r of rows) stmt.run(r.categoryId, r.id);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function getCategoryCounts() {
  return getDb().prepare(`
    SELECT category_id AS categoryId, COUNT(*) AS n FROM samples GROUP BY category_id
  `).all();
}

// ---- Type classification (Types tab, electron/classify/types.js) ----

function getSamplesForTypeClassification({ onlyUnclassified } = {}) {
  const where = onlyUnclassified ? 'WHERE type_id IS NULL' : '';
  return getDb().prepare(`
    SELECT id, path, duration_ms AS durationMs, category_id AS categoryId FROM samples ${where}
  `).all();
}

function setSampleTypes(rows) {
  if (!rows.length) return;
  const database = getDb();
  const stmt = database.prepare('UPDATE samples SET type_id = ?, subcategory_id = ? WHERE id = ?');
  database.exec('BEGIN');
  try {
    for (const r of rows) stmt.run(r.typeId, r.subcategoryId, r.id);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function listTypeCutoffs() {
  return getDb().prepare('SELECT type_id AS typeId, cutoff_value AS cutoffValue FROM type_cutoffs').all();
}

function updateTypeCutoff(typeId, value) {
  getDb().prepare('UPDATE type_cutoffs SET cutoff_value = ? WHERE type_id = ?').run(value, typeId);
}

// maxDurationMs narrows the count to samples whose parsed duration is at or
// under the type's current cut-off (a sample with no parsed duration is
// counted anyway, same "don't punish an unreadable header" reasoning as
// electron/classify/types.js).
function getTypeSubcategoryCounts(typeId, maxDurationMs) {
  return getDb().prepare(`
    SELECT subcategory_id AS subcategoryId, COUNT(*) AS n FROM samples
    WHERE type_id = ? AND (duration_ms IS NULL OR duration_ms <= ?)
    GROUP BY subcategory_id
  `).all(typeId, maxDurationMs);
}

// ---- Reroll (v0.5.0) ----

// Candidates for one pad's reroll: same type/subcategory/cut-off filter as
// getTypeSubcategoryCounts, plus excludeIds so a sample already sitting on
// another pad this roll can't be picked again.
function getRerollCandidates({ typeId, subcategoryId, maxDurationMs, excludeIds = [] }) {
  const placeholders = excludeIds.length ? excludeIds.map(() => '?').join(',') : null;
  const sql = `
    SELECT id, path, filename FROM samples
    WHERE type_id = ? AND subcategory_id = ? AND (duration_ms IS NULL OR duration_ms <= ?)
    ${placeholders ? `AND id NOT IN (${placeholders})` : ''}
  `;
  return getDb().prepare(sql).all(typeId, subcategoryId, maxDurationMs, ...excludeIds);
}

// Guards audio:read (main.js) against being used as an arbitrary-file-read
// primitive from the renderer — only paths already in the library index can
// be read back for audition.
function sampleExistsAtPath(samplePath) {
  return !!getDb().prepare('SELECT 1 FROM samples WHERE path = ?').get(samplePath);
}

// Used by v0.6.0 export to resolve each pad's chosen sample id into the real
// file path + parsed audio metadata needed to patch the .adg template.
function getSampleById(id) {
  return getDb().prepare(
    'SELECT id, path, filename, ext, size, mtime_ms, duration_ms, sample_rate FROM samples WHERE id = ?'
  ).get(id);
}

// ---- Settings (v1.0.0) ----
//
// Small persisted-preferences store — currently the Types tab's disabled
// subcategories and the "Audition on reroll" toggle, both of which used to
// reset to defaults on every app relaunch. Generic key/value rather than
// dedicated columns since neither the shape nor the count of settings is
// expected to stay fixed.

function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

function setSetting(key, value) {
  getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

function getStats() {
  const packs = getDb().prepare('SELECT COUNT(*) AS n FROM packs').get().n;
  const samples = getDb().prepare('SELECT COUNT(*) AS n FROM samples').get().n;
  return { packs, samples };
}

// Releases the sqlite file handle. Windows holds an exclusive lock on
// WAL-mode database files while open, so anything that needs the file free
// afterward (app shutdown, tests cleaning up a temp dir) should call this.
function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  listPacks, findPackByPath, addPack, removePack,
  getPackFileMap, upsertSamples, deleteSamplesNotIn, getStats, closeDb,
  listCategoryRules, updateCategoryRule, resetCategoryRule, resetAllCategoryRules,
  getSamplesForCategorization, setSampleCategories, getCategoryCounts,
  getSamplesForTypeClassification, setSampleTypes,
  listTypeCutoffs, updateTypeCutoff, getTypeSubcategoryCounts,
  getRerollCandidates, sampleExistsAtPath, getSampleById,
  getSettings, setSetting
};
