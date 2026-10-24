const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const { scanPack } = require('./scanner');
const { categorizeSamples, classifyTypes } = require('./classify');
const { TYPE_DEFS, MS_PER_BAR_AT_120BPM } = require('./classify/typeCategories');
const { buildAdgBuffer, skeletonAvailable, PAD_COUNT } = require('./export/adg');
const { resolvePads } = require('./export/resolvePads');
const liveBridge = require('./bridge/client');

// v0.6.0 scope: .adg export (export:adg, export:status). The Packs tab
// (v0.2.0) is backed by a real sqlite-backed index (see electron/db) built by
// walking the folders the user adds and parsing WAV/AIFF headers for
// duration (electron/scanner). Every sample gets a category_id via
// filename/parent-folder alias matching (electron/classify, v0.3.0), then a
// type_id/subcategory_id derived from that category plus duration and
// further filename hints (electron/classify/types.js, v0.4.0) — after each
// scan for new samples, and across the whole library whenever the user edits
// or resets a category's aliases or max length from the Rules tab, since
// either can move a sample between buckets. Reroll (v0.5.0) draws a
// weighted-random sample per pad from that classified pool, honoring the
// Types tab's One-Shot cut-off and disabled subcategories. Export clones the
// 16 DrumBranchPreset device chains out of a local, content-neutral skeleton
// (electron/export/skeleton.adg — derived from the user's own Ableton Live
// Pack via `npm run build:skeleton`, never committed) and patches in each
// pad's sample — see electron/export/adg.js and docs/IMPLEMENTATION_PLAN.md.
// v1.0.0 adds a persisted key/value settings store (settings:get-all,
// settings:set) and makes a single pack scan failure non-fatal to the rest
// of a batch (scanPacksSafely), reported to the renderer as a scan:progress
// entry with an `error` field instead of an unhandled IPC rejection.

// Loops' Types-tab cut-off is stored in bars; converts to ms using the same
// 120 BPM / 4-4 placeholder as the display (see typeCategories.js) so it can
// be compared against samples.duration_ms.
function cutoffToMs(typeId, cutoffValue) {
  return typeId === 'loop' ? cutoffValue * MS_PER_BAR_AT_120BPM : cutoffValue;
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 660,
    minWidth: 980,
    minHeight: 520,
    backgroundColor: '#181818',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

// Adds each new folder path as a pack (ignoring ones already tracked or not
// actually a directory), then scans every newly-added pack in turn,
// streaming progress to the renderer. Shared by both the native folder
// picker and drag-and-drop, which both end up with a list of absolute paths.
async function addPacksAndScan(candidatePaths) {
  const added = [];
  for (const p of candidatePaths) {
    let isDir = false;
    try { isDir = fs.statSync(p).isDirectory(); } catch { /* not accessible */ }
    if (!isDir) continue;
    if (db.findPackByPath(p)) continue; // already tracked
    added.push(db.addPack(p));
  }

  await scanPacksSafely(added);
  categorizeSamples(true); // only newly-scanned samples need a category_id
  classifyTypes(true); // ...and, in turn, a type_id/subcategory_id

  return db.listPacks();
}

// Scans each pack in turn, but a single pack that throws (permission denied,
// a path that vanishes mid-walk, etc.) doesn't abort the batch or leave the
// renderer's IPC await unhandled — it's reported via the same scan:progress
// channel as a done:true/error entry, and the remaining packs still scan.
async function scanPacksSafely(packs) {
  for (const pack of packs) {
    try {
      await scanPack(pack, (progress) => {
        mainWindow?.webContents.send('scan:progress', progress);
      });
    } catch (err) {
      mainWindow?.webContents.send('scan:progress', {
        packId: pack.id, packPath: pack.path, done: true, error: err.message
      });
    }
  }
}

ipcMain.handle('packs:list', () => db.listPacks());

ipcMain.handle('packs:add', async () => {
  if (!mainWindow) return db.listPacks();
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: 'A:\\Samples_Packs',
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled || result.filePaths.length === 0) return db.listPacks();
  return addPacksAndScan(result.filePaths);
});

ipcMain.handle('packs:add-paths', (_event, paths) => addPacksAndScan(Array.isArray(paths) ? paths : []));

ipcMain.handle('packs:remove', (_event, id) => {
  db.removePack(id);
  return db.listPacks();
});

ipcMain.handle('packs:rescan-all', async () => {
  await scanPacksSafely(db.listPacks());
  categorizeSamples(true);
  classifyTypes(true);
  return db.listPacks();
});

ipcMain.handle('stats:get', () => db.getStats());

// v1.0.0: persisted preferences (disabled reroll subcategories, "Audition on
// reroll") that previously reset to defaults on every relaunch — see
// electron/db/index.js for the generic key/value store behind this.
ipcMain.handle('settings:get-all', () => db.getSettings());
ipcMain.handle('settings:set', (_event, key, value) => db.setSetting(key, value));

// v1.1.2: Settings tab. The export folder picker needs a native dialog
// (main-process only), so it's its own handler rather than going through
// the generic settings:set — everything else about it (persistence, reading
// it back) reuses the same key/value store.
ipcMain.handle('settings:choose-export-dir', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  db.setSetting('exportDir', result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('settings:clear-export-dir', () => {
  db.setSetting('exportDir', null);
});

// v1.1.2: lets the user recover from a corrupted library.db (sqlite
// malformed-page errors, etc.) from inside the app instead of having to find
// and delete the file by hand. Only the index is destroyed — the user's
// actual sample files and pack folders on disk are never touched, so
// re-adding/rescanning those folders fully rebuilds it. WAL mode (see
// electron/db/index.js) means a live db can leave -wal/-shm sidecar files
// alongside library.db; all three need deleting together or a stale one
// could resurrect part of the corrupted state on reopen.
ipcMain.handle('db:reset', () => {
  db.closeDb();
  const dbPath = path.join(app.getPath('userData'), 'library.db');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* sidecar may not exist */ }
  }
  return { ok: true, stats: db.getStats(), packs: db.listPacks() }; // getStats() reopens a fresh db lazily
});

ipcMain.handle('rules:list', () => db.listCategoryRules());

ipcMain.handle('rules:update', (_event, id, patch) => {
  db.updateCategoryRule(id, patch);
  // An alias change can move samples between v0.3.0 categories; a
  // max-length change can't (matching doesn't look at it) but does move a
  // sample between One-Shot and Other in v0.4.0's type classification, so
  // either kind of edit needs a full type re-pass even when the category
  // pass itself is skipped.
  if (patch && patch.aliases !== undefined) categorizeSamples(false);
  if (patch && (patch.aliases !== undefined || patch.maxLenMs !== undefined)) classifyTypes(false);
  return db.listCategoryRules();
});

ipcMain.handle('rules:reset', (_event, id) => {
  db.resetCategoryRule(id);
  categorizeSamples(false);
  classifyTypes(false);
  return db.listCategoryRules();
});

ipcMain.handle('rules:reset-all', () => {
  db.resetAllCategoryRules();
  categorizeSamples(false);
  classifyTypes(false);
  return db.listCategoryRules();
});

ipcMain.handle('info:counts', () => {
  const rules = db.listCategoryRules();
  const counts = new Map(db.getCategoryCounts().map(c => [c.categoryId, c.n]));
  const rows = rules.map(r => ({ id: r.id, label: r.label, count: counts.get(r.id) || 0 }));
  rows.push({ id: 'uncategorized', label: 'Uncategorized', count: counts.get(null) || 0 });
  return rows;
});

ipcMain.handle('types:list', () => {
  const cutoffs = new Map(db.listTypeCutoffs().map(c => [c.typeId, c.cutoffValue]));
  return TYPE_DEFS.map(def => {
    const cutoffValue = cutoffs.get(def.id) ?? def.defaultCutoff;
    const maxMs = cutoffToMs(def.id, cutoffValue);
    const counts = new Map(db.getTypeSubcategoryCounts(def.id, maxMs).map(c => [c.subcategoryId, c.n]));
    return {
      id: def.id, label: def.label, stepperLabel: def.stepperLabel,
      stepUnit: def.stepUnit, stepDelta: def.stepDelta, stepMin: def.stepMin,
      cutoffValue,
      subcategories: def.subcategories.map(s => ({ id: s.id, label: s.label, count: counts.get(s.id) || 0 }))
    };
  });
});

ipcMain.handle('types:cutoff-update', (_event, typeId, value) => {
  db.updateTypeCutoff(typeId, value);
});

// v0.5.0: reroll. Every pad is pinned to a One-Shot subcategory (see
// PAD_DATA in src/renderer.js — a real drum-rack layout, e.g. the kick pad
// is always subcategory 'kicks'), so a reroll only ever draws from that
// pad's subcategory, filtered by the Types tab's One-Shot cut-off and
// whichever subcategories the user has unchecked there. "Weighted random"
// per the plan means uniform-random across that filtered pool — nothing in
// the spec calls for weighting by pack size, recency, or anything else, so
// this doesn't invent a scheme beyond what the filters already narrow down.
function disabledOneshotSubcatSet(disabledSubcatKeys) {
  return new Set(
    (disabledSubcatKeys || [])
      .filter(k => typeof k === 'string' && k.startsWith('oneshot:'))
      .map(k => k.slice('oneshot:'.length))
  );
}

function currentOneshotCutoffMs() {
  const cutoffs = new Map(db.listTypeCutoffs().map(c => [c.typeId, c.cutoffValue]));
  return cutoffToMs('oneshot', cutoffs.get('oneshot') ?? 1200);
}

// Returns { sample: {id, path, filename} | null, reason: null | 'disabled' | 'empty' }.
// excludeIds prevents the same sample landing on two pads in one roll.
function pickRerollCandidate(subcategoryId, excludeIds, disabledSubcats) {
  if (disabledSubcats.has(subcategoryId)) return { sample: null, reason: 'disabled' };
  const candidates = db.getRerollCandidates({
    typeId: 'oneshot', subcategoryId,
    maxDurationMs: currentOneshotCutoffMs(),
    excludeIds: [...excludeIds]
  });
  if (!candidates.length) return { sample: null, reason: 'empty' };
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return { sample: pick, reason: null };
}

ipcMain.handle('reroll:all', (_event, pads, disabledSubcatKeys) => {
  const disabledSubcats = disabledOneshotSubcatSet(disabledSubcatKeys);
  // Locked pads keep their sample and take it out of circulation for
  // everyone else being rerolled this pass; unlocked pads are skipped
  // entirely, matching "Reroll All skips locked pads."
  const used = new Set(pads.filter(p => p.locked && p.sampleId != null).map(p => p.sampleId));
  const results = [];
  for (const pad of pads) {
    if (pad.locked) continue;
    const { sample, reason } = pickRerollCandidate(pad.subcategoryId, used, disabledSubcats);
    if (sample) used.add(sample.id);
    results.push({ idx: pad.idx, sample, reason });
  }
  return results;
});

ipcMain.handle('reroll:one', (_event, pad, otherSampleIds, disabledSubcatKeys) => {
  const disabledSubcats = disabledOneshotSubcatSet(disabledSubcatKeys);
  const used = new Set(otherSampleIds || []);
  const { sample, reason } = pickRerollCandidate(pad.subcategoryId, used, disabledSubcats);
  return { idx: pad.idx, sample, reason };
});

// Reads sample bytes for Web Audio audition. Only paths already present in
// the library index are readable — the renderer can't use this to read
// arbitrary files off disk, even though it has to send a path across IPC.
ipcMain.handle('audio:read', (_event, filePath) => {
  if (typeof filePath !== 'string' || !db.sampleExistsAtPath(filePath)) return null;
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
});

// v0.6.0: .adg export. Resolves each pad's chosen sample id into the real
// path + audio metadata the export template needs (electron/export/adg.js
// does the actual XML patching/gzip; this handler is just DB/filesystem
// plumbing plus the save dialog). As of v1.1.1, an unfilled pad no longer
// blocks export — only a completely empty rack (0/16) does — an unfilled
// pad's branch is written out as an empty/unassigned Simpler chain (see
// adg.js's patchEmptyBranch) instead of a real sample.
ipcMain.handle('export:status', () => ({ skeletonAvailable: skeletonAvailable() }));

ipcMain.handle('export:adg', async (_event, pads) => {
  if (!Array.isArray(pads) || pads.length !== PAD_COUNT) {
    return { ok: false, reason: 'bad-input' };
  }
  if (!skeletonAvailable()) {
    return { ok: false, reason: 'no-skeleton' };
  }
  if (pads.every(p => p.sampleId == null)) {
    return { ok: false, reason: 'incomplete' };
  }

  const resolution = resolvePads(pads);
  if (!resolution.ok) return resolution;

  if (!mainWindow) return { ok: false, reason: 'no-window' };
  // v1.1.2: Settings tab lets the user pick a folder other than Electron's
  // default save-dialog location; falls back to Documents when unset.
  const exportDir = db.getSettings().exportDir || app.getPath('documents');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Drum Rack',
    defaultPath: path.join(exportDir, 'DDW Drum Rack.adg'),
    filters: [{ name: 'Ableton Drum Rack', extensions: ['adg'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };

  try {
    const buffer = buildAdgBuffer(resolution.resolved);
    fs.writeFileSync(result.filePath, buffer);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, reason: 'build-failed', detail: err.message };
  }
});

// v1.1.0: Max for Live "Send to Rack" bridge. bridge.json is written by the
// M4L device itself (m4l/ddw-bridge.js, Node for Max) into this app's own
// appData folder — a fixed, OS-derived path both sides agree on independent
// of this app's package.json name, since Electron's dev-mode app name and
// its packaged productName aren't guaranteed to match (see
// docs/IMPLEMENTATION_PLAN.md's v1.1.0 entry).
const BRIDGE_HANDSHAKE_PATH = path.join(app.getPath('appData'), 'DDW Drum Rack Generator', 'bridge.json');

ipcMain.handle('live:status', () => liveBridge.status(BRIDGE_HANDSHAKE_PATH));

ipcMain.handle('live:send', (_event, pads) => {
  if (!Array.isArray(pads) || pads.length !== PAD_COUNT || pads.every(p => p.sampleId == null)) {
    return { ok: false, reason: 'incomplete' };
  }
  const resolution = resolvePads(pads);
  if (!resolution.ok) return resolution;
  return liveBridge.send(BRIDGE_HANDSHAKE_PATH, resolution.resolved);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => db.closeDb());
