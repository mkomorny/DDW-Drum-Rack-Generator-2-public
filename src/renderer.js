/*
 * Renderer for the DDW Drum Rack Generator device shell.
 *
 * As of v0.2.0, the Packs tab and the mid-panel packs/samples stats are
 * backed by a real folder scan (electron/scanner) and sqlite index
 * (electron/db) via IPC exposed through window.ddw. As of v0.3.0, the Rules
 * tab and Info tab are backed by a real categorization engine
 * (electron/classify) — aliases are read/written through window.ddw.rules,
 * and candidate counts through window.ddw.info. As of v0.4.0, the Types tab
 * is backed by a real type/subcategory classifier (electron/classify/types.js)
 * — subcategory counts and each type's cut-off come from window.ddw.types,
 * and the cut-off stepper actually filters those counts instead of just
 * relabeling a static number. As of v0.5.0, the pad grid is real too: each
 * pad is pinned to a One-Shot subcategory (see PAD_DATA below), the dice
 * button and "Reroll all" draw a weighted-random matching sample via
 * window.ddw.reroll (honoring the Types tab's cut-off and any disabled
 * subcategories), locked pads are skipped by Reroll All and can't be
 * rerolled individually, and clicking a pad (or the dice, when "Audition on
 * reroll" is checked) plays the sample via Web Audio using bytes read
 * through window.ddw.audio.read. As of v0.6.0, "Export .adg" writes a real
 * Ableton Drum Rack preset via window.ddw.export.adg — disabled until every
 * pad has a sample (see updateExportButtonState). As of v1.0.0, disabled
 * subcategories and "Audition on reroll" persist across relaunches via
 * window.ddw.settings (loaded in init() below before the first render), the
 * export button also stays disabled with a clear tooltip when skeleton.adg
 * hasn't been built yet (checked proactively at startup, not just after a
 * failed export click), an unfilled pad reads as "-- no sample --" instead
 * of a mockup placeholder filename, and a folder-add/scan failure surfaces
 * a status message instead of failing silently. As of v1.1.0, an optional
 * Max for Live device on the same Live track can turn this into a live
 * bridge: window.ddw.live.status is polled on a timer (see pollLiveStatus),
 * and once it reports a connected device with a 16-pad-ready rack, "Send to
 * Rack" appears as a primary action next to Export .adg and pushes the
 * current rack straight into Live via window.ddw.live.send — no file, no
 * drag. Standalone launches never see it; see updateSendToRackUI. As of
 * v1.1.1, both outputs only require at least one filled pad rather than all
 * 16 (see updateExportButtonState/updateSendToRackUI), and each pad's cat
 * tag is a live <select> (SUBCATEGORY_META) that reassigns which One-Shot
 * subcategory the pad draws from, clearing its current sample via
 * retypePad. As of v1.1.2, a pad's sample name always shrinks its own
 * font-size to fit rather than ever growing the pad (see fitPadFileText),
 * and a new Settings tab (window.ddw.settings/db) exposes a default export
 * folder and a "Reset library database" recovery action for a corrupted
 * library.db.
 *
 * CSP forbids inline event handlers, so every element is wired via
 * addEventListener rather than onclick="" attributes (unlike the source
 * mockup, which used inline handlers since it was a standalone demo page).
 */

// ---- Pad grid, corrected to match a real Ableton Drum Rack ----
//
// The source mockup displayed rows 1-3 (top to bottom) in DESCENDING note
// order while row 4 was ascending — an inconsistency. A real Drum Rack's
// Pad View puts C1 (note 36) bottom-left, ascending left-to-right and
// bottom-to-top (see docs/DESIGN.md "Pad note order" for the citation).
// This array is laid out top-row-first for rendering, but every row
// ascends left-to-right and note number increases going up — matching Live.
//
// As of v0.5.0, each pad is pinned to one of the 7 One-Shot subcategories
// (electron/classify/typeCategories.js) — that's the finest granularity the
// classifier actually tracks, so e.g. RIDE and CRASH both draw from
// 'cymbals' rather than pretending the app can tell them apart. `sampleId`/
// `samplePath` start null (no real sample assigned) until the first reroll;
// `file`/`cat`/`catClass` stay as display placeholders from the approved
// mockup until then. `cat`/`catClass` are the pad's fixed role label and
// never change on reroll — only `file`/`sampleId`/`samplePath` do.

// `file` starts null (not a mockup placeholder filename) so an unfilled pad
// visually reads as empty rather than looking like it already has a real
// sample loaded — see renderGrid's "— no sample —" fallback (v1.0.0).
const PAD_DATA = [
  // Row 1 (top): 48-51
  { note: 48, noteName: 'C2',  cat: 'CRASH',  catClass: 'cat-hat',   subcategoryId: 'cymbals', sampleId: null, samplePath: null, file: null, locked: false },
  { note: 49, noteName: 'C#2', cat: 'SHAKER', catClass: 'cat-perc',  subcategoryId: 'perc',    sampleId: null, samplePath: null, file: null, locked: false },
  { note: 50, noteName: 'D2',  cat: 'PERC 1', catClass: 'cat-perc',  subcategoryId: 'perc',    sampleId: null, samplePath: null, file: null, locked: false },
  { note: 51, noteName: 'D#2', cat: 'PERC 2', catClass: 'cat-perc',  subcategoryId: 'perc',    sampleId: null, samplePath: null, file: null, locked: false },
  // Row 2: 44-47
  { note: 44, noteName: 'G#1', cat: 'RIDE',    catClass: 'cat-hat',  subcategoryId: 'cymbals', sampleId: null, samplePath: null, file: null, locked: false },
  { note: 45, noteName: 'A1',  cat: 'TOM LOW', catClass: 'cat-perc', subcategoryId: 'toms',    sampleId: null, samplePath: null, file: null, locked: false },
  { note: 46, noteName: 'A#1', cat: 'TOM MID', catClass: 'cat-perc', subcategoryId: 'toms',    sampleId: null, samplePath: null, file: null, locked: false },
  { note: 47, noteName: 'B1',  cat: 'TOM HI',  catClass: 'cat-perc', subcategoryId: 'toms',    sampleId: null, samplePath: null, file: null, locked: false },
  // Row 3: 40-43
  { note: 40, noteName: 'E1',  cat: 'CHAT', catClass: 'cat-hat',   subcategoryId: 'hats',   sampleId: null, samplePath: null, file: null, locked: false },
  { note: 41, noteName: 'F1',  cat: 'OHAT', catClass: 'cat-hat',   subcategoryId: 'hats',   sampleId: null, samplePath: null, file: null, locked: false },
  { note: 42, noteName: 'F#1', cat: 'SNAP', catClass: 'cat-snare', subcategoryId: 'claps',  sampleId: null, samplePath: null, file: null, locked: false },
  { note: 43, noteName: 'G1',  cat: 'CLAP', catClass: 'cat-snare', subcategoryId: 'claps',  sampleId: null, samplePath: null, file: null, locked: false },
  // Row 4 (bottom): 36-39
  { note: 36, noteName: 'C1',  cat: 'KICK',    catClass: 'cat-kick',  subcategoryId: 'kicks',  sampleId: null, samplePath: null, file: null, locked: true },
  { note: 37, noteName: 'C#1', cat: '808 SUB', catClass: 'cat-808',   subcategoryId: 'kicks',  sampleId: null, samplePath: null, file: null, locked: false },
  { note: 38, noteName: 'D1',  cat: 'RIM',     catClass: 'cat-snare', subcategoryId: 'snares', sampleId: null, samplePath: null, file: null, locked: false },
  { note: 39, noteName: 'D#1', cat: 'SNARE',   catClass: 'cat-snare', subcategoryId: 'snares', sampleId: null, samplePath: null, file: null, locked: true }
];

// v1.1.1: lets a pad's One-Shot subcategory be changed after the fact (the
// cat tag becomes a <select>, see renderGrid) instead of being fixed for the
// pad's lifetime. Deliberately hardcoded here rather than read from
// window.ddw.types — the pad grid renders before that IPC round-trip
// resolves, and these 7 subcategories/labels are the same fixed set
// typeCategories.js's ONE_SHOT_SUBCATEGORIES has always exposed to this pad
// grid (see the top-of-file comment). catClass reuses the same 5 color
// buckets the original hardcoded pad roles already used (there's no
// per-subcategory color, just a broader kick/snare/hat/perc grouping).
const SUBCATEGORY_META = {
  kicks:   { label: 'KICK',   catClass: 'cat-kick' },
  snares:  { label: 'SNARE',  catClass: 'cat-snare' },
  claps:   { label: 'CLAP',   catClass: 'cat-snare' },
  hats:    { label: 'HAT',    catClass: 'cat-hat' },
  toms:    { label: 'TOM',    catClass: 'cat-perc' },
  perc:    { label: 'PERC',   catClass: 'cat-perc' },
  cymbals: { label: 'CYMBAL', catClass: 'cat-hat' }
};
const SUBCATEGORY_ORDER = ['kicks', 'snares', 'claps', 'hats', 'toms', 'cymbals', 'perc'];

// ---- State ----

let activeTab = 'types';
let activeTypeKey = 'oneshot';
let activeRuleCategory = null;
let currentPacks = [];
let currentRules = [];
let currentTypes = [];
// Client-only "exclude from candidate pool" state, keyed by "typeId:subcatId".
// Not persisted, but as of v0.5.0 the reroll engine reads it: any pad whose
// subcategory is disabled here gets no candidates.
let disabledSubcats = new Set();
let renderToken = 0; // guards against a slow async tab render landing after the user has switched away

// v1.0.0: whether electron/export/skeleton.adg exists, checked once at
// startup (not just discovered after a failed export click) so the export
// button's disabled state/tooltip is accurate immediately — see
// updateExportButtonState and the init block at the bottom of this file.
let skeletonReady = true;

// v1.1.0: last-known state of the optional Max for Live bridge, polled on a
// timer (see pollLiveStatus below). null until the first poll resolves;
// { connected: false } once polled with nothing found — either way,
// standalone export (Export .adg) never depends on this.
let liveStatus = null;

// Shared AudioContext + the currently-playing source, so a new audition
// (dice reroll, a fresh pad click) cuts off whatever was already sounding
// instead of letting auditions stack up.
let audioCtx = null;
let currentAudioSource = null;

// ---- DOM refs ----

const panelEl = document.getElementById('panel-content');
const gridEl = document.getElementById('pad-grid');
const statusEl = document.getElementById('status-box');
const tabIndicatorEl = document.getElementById('live-tab-indicator');
const statsPacksEl = document.getElementById('stats-packs');
const statsSamplesEl = document.getElementById('stats-samples');
const exportBtnEl = document.getElementById('export-btn');
const sendToRackBtnEl = document.getElementById('send-to-rack-btn');
const liveStatusEl = document.getElementById('live-status');
const liveStatusTextEl = document.getElementById('live-status-text');

// ---- Helpers ----

function setStatus(msg) {
  statusEl.textContent = msg;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Reads a sample's bytes over IPC (the renderer has no direct fs access)
// and plays it via Web Audio, stopping whatever was already auditioning.
async function playSample(path) {
  if (!path) return;
  const bytes = await window.ddw.audio.read(path);
  if (!bytes) {
    setStatus('Could not read that sample for audition.');
    return;
  }
  try {
    audioCtx = audioCtx || new AudioContext();
    if (currentAudioSource) {
      try { currentAudioSource.stop(); } catch { /* already finished */ }
    }
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
    currentAudioSource = source;
  } catch {
    setStatus('Could not play that sample (unsupported audio format).');
  }
}

// ---- Panel renderers ----

async function renderTypesPanel(token) {
  panelEl.innerHTML = '<div class="panel-heading"><span>Loading types&hellip;</span></div>';
  currentTypes = await window.ddw.types.list();
  if (token !== renderToken) return; // user switched tabs while this was loading

  if (!currentTypes.length) {
    panelEl.innerHTML = '<div class="c1-pack-empty">No types configured.</div>';
    return;
  }
  if (!currentTypes.some(t => t.id === activeTypeKey)) {
    activeTypeKey = currentTypes[0].id;
  }
  const cfg = currentTypes.find(t => t.id === activeTypeKey);

  const options = currentTypes
    .map(t => `<option value="${t.id}" ${t.id === activeTypeKey ? 'selected' : ''}>&#9660; Type: ${escapeHtml(t.label)}</option>`)
    .join('');

  const rows = cfg.subcategories.map(item => {
    const key = `${cfg.id}:${item.id}`;
    const checked = !disabledSubcats.has(key);
    return `
    <div class="c1-filter-row">
      <div class="c1-filter-chk">
        <input type="checkbox" ${checked ? 'checked' : ''} data-subcat-key="${key}">
        <span>${escapeHtml(item.label)}</span>
      </div>
      <span class="c1-filter-count">${item.count}</span>
    </div>
  `;
  }).join('');

  panelEl.innerHTML = `
    <div class="type-dropdown-wrapper">
      <select class="c1-type-select" id="type-select">${options}</select>
    </div>
    <div class="c1-filter-list">${rows}</div>
    <div class="cutoff-stepper-box">
      <span>${cfg.stepperLabel} <strong id="type-stepper-val">${formatStepperVal(cfg)}</strong></span>
      <div style="display:flex; gap:4px;">
        <button class="c1-step-btn" id="step-down" type="button">-</button>
        <button class="c1-step-btn" id="step-up" type="button">+</button>
      </div>
    </div>
  `;

  document.getElementById('type-select').addEventListener('change', (e) => {
    activeTypeKey = e.target.value;
    switchTab('types');
    setStatus(`Switched Type to ${cfg.label}.`);
  });

  panelEl.querySelectorAll('[data-subcat-key]').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const key = e.target.dataset.subcatKey;
      if (e.target.checked) disabledSubcats.delete(key); else disabledSubcats.add(key);
      window.ddw.settings.set('disabledSubcats', [...disabledSubcats]);
      setStatus(`${e.target.checked ? 'Enabled' : 'Disabled'} that subcategory for the reroll candidate pool.`);
    });
  });

  document.getElementById('step-down').addEventListener('click', () => stepTypeCutoff(cfg, -1));
  document.getElementById('step-up').addEventListener('click', () => stepTypeCutoff(cfg, 1));
}

function formatStepperVal(cfg) {
  // Loops' cut-off is stored in bars; the "(Ns)" suffix is display-only,
  // using the same 120 BPM / 4-4 placeholder as the count-filtering
  // conversion in main.js (see docs/IMPLEMENTATION_PLAN.md open items).
  const suffix = cfg.id === 'loop' ? ` (${cfg.cutoffValue * 2}s)` : '';
  return `${cfg.cutoffValue}${cfg.stepUnit}${suffix}`;
}

async function stepTypeCutoff(cfg, dir) {
  const newVal = Math.max(cfg.stepMin, cfg.cutoffValue + dir * cfg.stepDelta);
  cfg.cutoffValue = newVal;
  document.getElementById('type-stepper-val').textContent = formatStepperVal(cfg);
  setStatus(`${cfg.stepperLabel} set to ${formatStepperVal(cfg)} — refreshing counts…`);
  await window.ddw.types.updateCutoff(cfg.id, newVal);
  switchTab('types'); // re-fetch so subcategory counts reflect the new cut-off
}

function basename(p) {
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function renderFolderPanel() {
  const rows = currentPacks.map(pack => `
    <div class="c1-pack-item" data-pack-id="${pack.id}">
      <span class="name" title="${escapeHtml(pack.path)}">${escapeHtml(basename(pack.path))}</span>
      <span class="count">${pack.sampleCount}</span>
      <button class="remove" type="button" data-pack-id="${pack.id}" title="Remove pack">&#10005;</button>
    </div>
  `).join('');

  panelEl.innerHTML = `
    <div class="panel-heading"><span>Sample Folders</span></div>
    <div class="c1-dropzone" id="dropzone">
      &#128229; Drop sample folders here<br><span style="font-size:0.66rem; color:#666;">or click to browse</span>
    </div>
    <div class="c1-pack-list" id="pack-list">${rows || '<div class="c1-pack-empty">No packs loaded yet.</div>'}</div>
  `;

  const dropzone = document.getElementById('dropzone');

  dropzone.addEventListener('click', async () => {
    setStatus('Opening folder picker…');
    try {
      currentPacks = await window.ddw.packs.add();
    } catch (err) {
      setStatus(`Couldn't add that folder: ${err.message}`);
      return;
    }
    renderFolderPanel();
    refreshLibraryStats();
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    await handleFolderDrop(e);
  });

  panelEl.querySelectorAll('.c1-pack-item .remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(e.target.dataset.packId);
      setStatus('Removing pack…');
      currentPacks = await window.ddw.packs.remove(id);
      renderFolderPanel();
      refreshLibraryStats();
      setStatus('Pack removed.');
    });
  });
}

async function handleFolderDrop(e) {
  const items = e.dataTransfer.items;
  if (!items || !items.length) return;

  const paths = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry && !entry.isDirectory) continue; // Packs are folders, not loose files
    const file = item.getAsFile();
    if (!file) continue;
    const path = window.ddw.getDroppedPath(file);
    if (path) paths.push(path);
  }

  if (!paths.length) {
    setStatus('Drop a folder, not individual files.');
    return;
  }

  setStatus(`Adding ${paths.length} folder${paths.length === 1 ? '' : 's'}…`);
  try {
    currentPacks = await window.ddw.packs.addPaths(paths);
  } catch (err) {
    setStatus(`Couldn't add those folders: ${err.message}`);
    return;
  }
  renderFolderPanel();
  refreshLibraryStats();
}

async function renderRulesPanel(token) {
  panelEl.innerHTML = '<div class="panel-heading"><span>Loading rules&hellip;</span></div>';
  currentRules = await window.ddw.rules.list();
  if (token !== renderToken) return; // user switched tabs while this was loading

  if (!currentRules.length) {
    panelEl.innerHTML = '<div class="c1-pack-empty">No categories configured.</div>';
    return;
  }
  if (!currentRules.some(c => c.id === activeRuleCategory)) {
    activeRuleCategory = currentRules[0].id;
  }
  const cat = currentRules.find(c => c.id === activeRuleCategory);

  const options = currentRules
    .map(c => `<option value="${c.id}" ${c.id === activeRuleCategory ? 'selected' : ''}>${escapeHtml(c.label)} &#9662;</option>`)
    .join('');

  panelEl.innerHTML = `
    <select class="c1-cat-select" id="rule-select">${options}</select>
    <div class="c1-alias-box"><strong>Current aliases:</strong><br>${escapeHtml(cat.aliases.join(', '))}</div>
    <input class="c1-alias-input" id="alias-input" type="text" placeholder="Type new aliases, comma-separated...">
    <div class="c1-alias-input-tip">Enter replaces the list above.</div>
    <div class="cutoff-stepper-box">
      <span>Max length: <strong id="rule-len-val">${cat.maxLenMs} ms</strong></span>
      <div style="display:flex; gap:4px;">
        <button class="c1-step-btn" id="rule-step-down" type="button">-</button>
        <button class="c1-step-btn" id="rule-step-up" type="button">+</button>
      </div>
    </div>
    <button class="c1-reset-btn" id="rule-reset" style="margin-top:8px;" type="button">&#8630; Reset to default</button>
  `;

  document.getElementById('rule-select').addEventListener('change', (e) => {
    activeRuleCategory = e.target.value;
    switchTab('categories');
  });

  document.getElementById('alias-input').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const raw = e.target.value.trim();
    if (!raw) return;
    const aliases = raw.split(',').map(s => s.trim()).filter(Boolean);
    e.target.value = '';
    setStatus(`Updating aliases for ${cat.label}…`);
    await window.ddw.rules.update(cat.id, { aliases });
    setStatus(`Updated aliases for ${cat.label}.`);
    switchTab('categories');
  });

  document.getElementById('rule-step-down').addEventListener('click', () => stepRuleLength(cat, -50));
  document.getElementById('rule-step-up').addEventListener('click', () => stepRuleLength(cat, 50));
  document.getElementById('rule-reset').addEventListener('click', async () => {
    setStatus(`Resetting ${cat.label} to default…`);
    await window.ddw.rules.reset(cat.id);
    setStatus(`${cat.label} rules reset to default.`);
    switchTab('categories');
  });
}

async function stepRuleLength(cat, delta) {
  const newVal = Math.max(50, cat.maxLenMs + delta);
  document.getElementById('rule-len-val').textContent = `${newVal} ms`; // optimistic; confirmed by the IPC round-trip below
  cat.maxLenMs = newVal;
  await window.ddw.rules.update(cat.id, { maxLenMs: newVal });
  setStatus(`Max length for ${cat.label} set to ${newVal} ms.`);
}

async function renderInfoPanel(token) {
  panelEl.innerHTML = '<div class="panel-heading"><span>Loading candidate counts&hellip;</span></div>';
  const rows = await window.ddw.info.counts();
  if (token !== renderToken) return; // user switched tabs while this was loading

  const html = rows.map(row => `
    <div class="c1-info-row ${row.count === 0 ? 'empty' : ''}">
      <span>${escapeHtml(row.label)}:</span><span>${row.count === 0 ? '0 (empty)' : row.count}</span>
    </div>
  `).join('');
  panelEl.innerHTML = `
    <div class="panel-heading"><span>Candidate counts</span></div>
    <div class="c1-info-grid">${html}</div>
  `;
}

async function renderSettingsPanel(token) {
  panelEl.innerHTML = '<div class="panel-heading"><span>Loading settings&hellip;</span></div>';
  const [settings, dbStats] = await Promise.all([
    window.ddw.settings.getAll(),
    window.ddw.stats.get()
  ]);
  if (token !== renderToken) return; // user switched tabs while this was loading

  const exportDir = settings.exportDir || null;

  panelEl.innerHTML = `
    <div class="panel-heading"><span>Settings</span></div>
    <div class="c1-settings-group">
      <div class="c1-settings-label">Default export folder</div>
      <div class="c1-settings-path" title="${escapeHtml(exportDir || 'Documents (default)')}">${escapeHtml(exportDir ? basename(exportDir) : 'Documents (default)')}</div>
      <div class="c1-settings-actions">
        <button class="c1-step-btn c1-settings-btn" id="choose-export-dir" type="button">Change&hellip;</button>
        ${exportDir ? '<button class="c1-step-btn c1-settings-btn" id="clear-export-dir" type="button">Reset</button>' : ''}
      </div>
    </div>
    <div class="c1-settings-group">
      <div class="c1-settings-label">Library database</div>
      <div class="c1-settings-path">${dbStats.packs} pack${dbStats.packs === 1 ? '' : 's'} &middot; ${dbStats.samples} sample${dbStats.samples === 1 ? '' : 's'} indexed</div>
      <div class="c1-alias-input-tip">If the app reports database errors, resetting clears the sample index only — your pack folders and sample files on disk are untouched. Re-add and rescan them afterward to rebuild it.</div>
      <button class="c1-reset-btn" id="reset-db" type="button">&#9888;&#65039; Reset library database&hellip;</button>
    </div>
  `;

  document.getElementById('choose-export-dir').addEventListener('click', async () => {
    const dir = await window.ddw.settings.chooseExportDir();
    if (dir) {
      setStatus(`Default export folder set to ${dir}.`);
      switchTab('settings');
    }
  });

  const clearBtn = document.getElementById('clear-export-dir');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await window.ddw.settings.clearExportDir();
      setStatus('Default export folder reset to Documents.');
      switchTab('settings');
    });
  }

  document.getElementById('reset-db').addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Reset the library database?\n\nThis clears your indexed packs and samples. Your actual pack folders and sample files on disk are NOT touched — you\'ll need to re-add and rescan those folders afterward to rebuild the index.'
    );
    if (!confirmed) return;
    setStatus('Resetting library database…');
    const result = await window.ddw.db.reset();
    currentPacks = result.packs || [];
    refreshLibraryStats();
    setStatus('Library database reset. Re-add your pack folders (Packs tab) to rebuild it.');
    switchTab('settings');
  });
}

const TAB_RENDERERS = {
  folder: () => renderFolderPanel(),
  types: (token) => renderTypesPanel(token),
  categories: (token) => renderRulesPanel(token),
  info: (token) => renderInfoPanel(token),
  settings: (token) => renderSettingsPanel(token)
};

const TAB_INDICATOR_NAMES = {
  folder: 'FOLDER INGESTION',
  types: 'TYPE OPTIONS (LOOPS / ONE-SHOTS / OTHER)',
  categories: 'CATEGORIZATION & ALIASES',
  info: 'TELEMETRY & CANDIDATE COUNTS',
  settings: 'SETTINGS'
};

function switchTab(tabKey) {
  activeTab = tabKey;
  const token = ++renderToken;
  TAB_RENDERERS[tabKey](token);
  tabIndicatorEl.textContent = `TAB: ${TAB_INDICATOR_NAMES[tabKey]}`;

  document.querySelectorAll('.c1-rail-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`rail-btn-${tabKey}`).classList.add('active');
}

// ---- Pad grid ----

function catOptionsHtml(pad) {
  return SUBCATEGORY_ORDER.map(id =>
    `<option value="${id}" ${id === pad.subcategoryId ? 'selected' : ''}>${SUBCATEGORY_META[id].label}</option>`
  ).join('');
}

// v1.1.2: the pad grid must never resize/reflow when a sample name changes
// (see .c1-pad-file/.c1-pad-top/.c1-pad-bottom in device.css — the pad's box
// is fixed, .c1-pad-file just absorbs the leftover space between the other
// two rows). Instead, the text shrinks to fit: starting from the CSS
// default font-size, this steps the font down in 0.5px increments until the
// element's content stops overflowing its own (fixed) box. Only if it's
// still overflowing at the readability floor does it fall back to trimming
// characters and appending "…" — CSS alone can't make this decision because
// "does this text fit" depends on the actual rendered layout, not anything
// expressible as a single fixed rule.
const PAD_FILE_MIN_FONT_PX = 6;

function fitPadFileText(el) {
  if (el.dataset.full === undefined) el.dataset.full = el.textContent;
  const full = el.dataset.full;
  el.textContent = full;
  el.style.fontSize = '';
  let fontPx = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollHeight > el.clientHeight + 0.5 && fontPx > PAD_FILE_MIN_FONT_PX) {
    fontPx -= 0.5;
    el.style.fontSize = `${fontPx}px`;
  }
  if (el.scrollHeight > el.clientHeight + 0.5) {
    let text = full;
    while (text.length > 1 && el.scrollHeight > el.clientHeight + 0.5) {
      text = text.slice(0, -1);
      el.textContent = text + '…';
    }
  }
}

function fitAllPadFileTexts() {
  gridEl.querySelectorAll('.c1-pad-file').forEach(fitPadFileText);
}

function renderGrid() {
  gridEl.innerHTML = PAD_DATA.map((pad, idx) => `
    <div class="c1-pad ${pad.locked ? 'locked' : ''}" data-idx="${idx}">
      <div class="c1-pad-top">
        <select class="c1-pad-cat-select ${pad.catClass}" ${pad.locked ? 'disabled' : ''} title="Change this pad's sample type">${catOptionsHtml(pad)}</select>
        <button class="pad-btn dice-btn" type="button" title="Reroll this pad">&#127922;</button>
      </div>
      <div class="c1-pad-file ${pad.file ? '' : 'empty'}">${pad.file ? escapeHtml(pad.file) : '— no sample —'}</div>
      <div class="c1-pad-bottom">
        <span class="c1-pad-note">${pad.noteName}</span>
        <button class="pad-btn lock-icon ${pad.locked ? 'locked' : ''}" type="button" title="Toggle lock">${pad.locked ? '&#128274;' : '&#128275;'}</button>
      </div>
    </div>
  `).join('');

  gridEl.querySelectorAll('.c1-pad').forEach(el => {
    // Clicking a pad auditions its current sample; the lock/dice buttons
    // below stop propagation so they don't also trigger an audition.
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      const pad = PAD_DATA[idx];
      if (!pad.samplePath) {
        setStatus('No sample loaded on this pad yet — reroll it first.');
        return;
      }
      playSample(pad.samplePath);
      setStatus(`Auditioning ${pad.file} (${pad.cat}).`);
    });
  });

  gridEl.querySelectorAll('.lock-icon').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(e.target.closest('.c1-pad').dataset.idx);
      togglePadLock(idx);
    });
  });

  gridEl.querySelectorAll('.dice-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(e.target.closest('.c1-pad').dataset.idx);
      rerollPad(idx);
    });
  });

  gridEl.querySelectorAll('.c1-pad-cat-select').forEach(sel => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.closest('.c1-pad').dataset.idx);
      retypePad(idx, e.target.value);
    });
  });

  fitAllPadFileTexts();
  updateExportButtonState();
}

// Changing a pad's subcategory clears whatever sample it was holding — a
// sample matched to the old subcategory has no guarantee of fitting the new
// one, so the pad reads "— no sample —" until rerolled, same as a freshly
// unlocked, never-rolled pad.
function retypePad(idx, subcategoryId) {
  const pad = PAD_DATA[idx];
  const meta = SUBCATEGORY_META[subcategoryId];
  pad.subcategoryId = subcategoryId;
  pad.cat = meta.label;
  pad.catClass = meta.catClass;
  pad.sampleId = null;
  pad.samplePath = null;
  pad.file = null;
  renderGrid();
  setStatus(`Pad ${pad.noteName} retyped to ${meta.label} — reroll it to fill.`);
}

// As of v1.1.1, export only needs at least one filled pad, not all 16 — an
// unfilled pad's branch is written out as an empty/unassigned Simpler
// (electron/export/adg.js's patchEmptyBranch) rather than blocking export
// outright.
function updateExportButtonState() {
  if (!skeletonReady) {
    exportBtnEl.disabled = true;
    exportBtnEl.title = 'Export isn\'t set up yet — run "npm run build:skeleton" once (see README), then restart the app.';
  } else {
    const filledCount = PAD_DATA.filter(p => p.sampleId != null).length;
    exportBtnEl.disabled = filledCount === 0;
    exportBtnEl.title = filledCount > 0
      ? (filledCount < PAD_DATA.length
        ? `Export the current rack as a .adg (${filledCount}/${PAD_DATA.length} pads filled — the rest export empty)`
        : 'Export the current rack as a .adg you can drag into Live')
      : 'Fill at least one pad first — Reroll all to get started.';
  }
  updateSendToRackUI();
}

// v1.1.0: Send to Rack only appears once a device is actually connected —
// standalone launches (liveStatus null or { connected: false }) never show
// it, so Export .adg is the only control anyone without the M4L device ever
// sees. When connected, it additionally needs at least one pad filled here
// (same relaxed rule as .adg export, v1.1.1) AND the rack on the Live side
// already holding 16 Simpler pads (padsReady, reported by the device) — the
// one-time seed step described in docs/IMPLEMENTATION_PLAN.md's v1.1.0
// entry. An unfilled DDW pad is simply left out of the send (see
// electron/bridge/client.js) — the matching Live pad keeps its own sample.
function updateSendToRackUI() {
  const connected = !!(liveStatus && liveStatus.connected);
  sendToRackBtnEl.classList.toggle('hidden', !connected);
  liveStatusEl.classList.toggle('hidden', !connected);
  liveStatusEl.classList.toggle('connected', connected);
  if (!connected) return;

  const padsReady = liveStatus.padsReady ?? 0;
  liveStatusTextEl.textContent = `${liveStatus.rackName || 'Drum Rack'} — ${padsReady}/16 pads`;

  const filledCount = PAD_DATA.filter(p => p.sampleId != null).length;
  const rackReady = padsReady >= 16;
  sendToRackBtnEl.disabled = filledCount === 0 || !rackReady;
  if (!rackReady) {
    sendToRackBtnEl.title = `Rack has ${padsReady}/16 Simpler pads — export a .adg and drag it onto this track once, then Send to Rack works from here on`;
  } else if (filledCount === 0) {
    sendToRackBtnEl.title = 'Fill at least one pad first — Reroll all to get started.';
  } else {
    sendToRackBtnEl.title = filledCount < PAD_DATA.length
      ? `Load the current rack straight into Live (${filledCount}/${PAD_DATA.length} pads filled — the rest are left as-is)`
      : 'Load the current rack straight into Live — no file, no drag';
  }
}

async function pollLiveStatus() {
  liveStatus = await window.ddw.live.status();
  updateSendToRackUI();
}

function togglePadLock(idx) {
  const pad = PAD_DATA[idx];
  pad.locked = !pad.locked;
  renderGrid();
  setStatus(pad.locked ? `Pad locked (${pad.cat} — note ${pad.note}).` : `Pad unlocked (${pad.cat} — note ${pad.note}).`);
}

// Reroll one pad, excluding every sample currently sitting on another pad
// (locked or not) so a single-pad reroll can't collide with the rest of the
// rack, same "no duplicate sample per roll" rule Reroll All follows.
async function rerollPad(idx) {
  const pad = PAD_DATA[idx];
  if (pad.locked) {
    setStatus(`${pad.cat} is locked — unlock it before rerolling.`);
    return;
  }
  setStatus(`Rerolling ${pad.cat}…`);
  const otherSampleIds = PAD_DATA
    .filter((p, i) => i !== idx && p.sampleId != null)
    .map(p => p.sampleId);
  const result = await window.ddw.reroll.one(
    { idx, subcategoryId: pad.subcategoryId },
    otherSampleIds,
    [...disabledSubcats]
  );
  applyRerollResult(result);
  if (result.sample) {
    renderGrid();
    setStatus(`${pad.cat} → ${pad.file}`);
    if (document.getElementById('audition-chk').checked) playSample(pad.samplePath);
  } else {
    setStatus(`Could not reroll ${pad.cat} — ${rerollFailureReason(result.reason)}.`);
  }
}

function rerollFailureReason(reason) {
  return reason === 'disabled'
    ? 'that subcategory is unchecked in the Types tab'
    : 'no matching samples in the library (check the Types tab cut-off, or add more packs)';
}

function applyRerollResult(result) {
  const pad = PAD_DATA[result.idx];
  if (!result.sample) return;
  pad.sampleId = result.sample.id;
  pad.samplePath = result.sample.path;
  pad.file = result.sample.filename;
}

// ---- Mid panel ----
//
// Packs/samples counts reflect the real sqlite-backed library index (see
// electron/db) as of v0.2.0. Category candidate counts (Info tab) are real
// as of v0.3.0, and per-type/subcategory candidate counts (Types tab row
// counts) are real as of v0.4.0. As of v0.5.0 the reroll button is real too.

async function refreshLibraryStats() {
  const stats = await window.ddw.stats.get();
  statsPacksEl.textContent = String(stats.packs);
  statsSamplesEl.textContent = String(stats.samples);
}

document.getElementById('reroll-btn').addEventListener('click', async () => {
  setStatus('Rerolling unlocked pads…');
  const padsPayload = PAD_DATA.map((p, idx) => ({
    idx, subcategoryId: p.subcategoryId, locked: p.locked, sampleId: p.sampleId
  }));
  const results = await window.ddw.reroll.all(padsPayload, [...disabledSubcats]);
  let filled = 0;
  const emptyReasons = new Set();
  for (const result of results) {
    if (result.sample) { applyRerollResult(result); filled++; }
    else emptyReasons.add(rerollFailureReason(result.reason));
  }
  renderGrid();

  const lockedCount = PAD_DATA.filter(p => p.locked).length;
  let msg = `Rerolled ${filled} pad${filled === 1 ? '' : 's'}`;
  if (lockedCount) msg += ` (${lockedCount} locked, skipped)`;
  msg += '.';
  if (emptyReasons.size) msg += ` Some pads had no candidates: ${[...emptyReasons].join('; ')}.`;
  setStatus(msg);
  // Reroll All deliberately doesn't auto-audition — playing every newly
  // rolled pad at once would just be noise. Individual dice rerolls (and
  // clicking any pad directly) still audition on demand.
});

const EXPORT_FAILURE_MESSAGES = {
  'no-skeleton': 'Export isn\'t set up yet — run "npm run build:skeleton" once (see README), then restart the app.',
  'incomplete': 'Fill at least one pad first — reroll all to get started.',
  'missing-sample': (d) => `A pad's sample file is missing on disk: ${d}. Rescan your packs or reroll that pad.`,
  'unreadable-sample': (d) => `Couldn't read audio info for ${d}.`,
  'build-failed': (d) => `Export failed: ${d}`,
  'no-window': 'Export failed: no window to show the save dialog in.',
  'bad-input': 'Export failed: unexpected pad data.'
};

exportBtnEl.addEventListener('click', async () => {
  exportBtnEl.disabled = true;
  setStatus('Exporting…');
  const padsPayload = PAD_DATA.map((p, idx) => ({ idx, note: p.note, sampleId: p.sampleId }));
  const result = await window.ddw.export.adg(padsPayload);
  if (result.ok) {
    setStatus(`Exported to ${result.path} — drag it into Live to load the rack.`);
  } else if (result.reason !== 'cancelled') {
    const entry = EXPORT_FAILURE_MESSAGES[result.reason];
    setStatus(typeof entry === 'function' ? entry(result.detail) : (entry || `Export failed: ${result.reason}`));
  } else {
    setStatus('Export cancelled.');
  }
  updateExportButtonState();
});

const LIVE_SEND_FAILURE_MESSAGES = {
  'incomplete': 'Fill at least one pad first — reroll all to get started.',
  'not-connected': 'Lost the connection to the device — check it\'s still loaded on the track.',
  'missing-sample': (d) => `A pad's sample file is missing on disk: ${d}. Rescan your packs or reroll that pad.`,
  'unreadable-sample': (d) => `Couldn't read audio info for ${d}.`,
  'send-failed': (d) => `Send to Rack failed: ${d}`
};

sendToRackBtnEl.addEventListener('click', async () => {
  sendToRackBtnEl.disabled = true;
  setStatus('Sending to rack…');
  const padsPayload = PAD_DATA.map((p, idx) => ({ idx, note: p.note, sampleId: p.sampleId }));
  const result = await window.ddw.live.send(padsPayload);
  if (result.ok) {
    // result.results only covers pads that were actually filled and sent —
    // an unfilled DDW pad isn't included at all (see client.js), so its
    // count is never "out of 16" once the rack isn't fully rolled.
    const sent = result.results || [];
    const failed = sent.filter(r => !r.ok);
    setStatus(failed.length
      ? `Sent — ${sent.length - failed.length}/${sent.length} pads loaded; ${failed.length} pad${failed.length === 1 ? '' : 's'} failed (check the Max console).`
      : `Sent — all ${sent.length} filled pad${sent.length === 1 ? '' : 's'} loaded straight into Live.`);
  } else {
    const entry = LIVE_SEND_FAILURE_MESSAGES[result.reason];
    setStatus(typeof entry === 'function' ? entry(result.detail) : (entry || `Send to Rack failed: ${result.reason}`));
  }
  await pollLiveStatus();
});

document.getElementById('audition-chk').addEventListener('change', (e) => {
  window.ddw.settings.set('auditionOnReroll', e.target.checked);
  setStatus(e.target.checked ? 'Audition on reroll enabled.' : 'Audition on reroll disabled.');
});

window.ddw.onScanProgress((progress) => {
  const name = basename(progress.packPath);
  if (progress.error) {
    setStatus(`Couldn't scan "${name}": ${progress.error}`);
  } else if (progress.done) {
    setStatus(`Scanned "${name}": ${progress.added} new, ${progress.updated} updated, ${progress.removed} removed, ${progress.unreadable} unreadable.`);
  } else {
    setStatus(`Scanning "${name}"… ${progress.scanned} files (${progress.added} new, ${progress.updated} updated)`);
  }
  refreshLibraryStats();
  if (activeTab === 'folder') {
    window.ddw.packs.list().then(packs => {
      currentPacks = packs;
      renderFolderPanel();
    });
  }
});

// The window has a minWidth/minHeight but is still user-resizable (see
// electron/main.js), which changes how much space each pad actually has —
// re-fit text on resize rather than leaving whatever size was chosen at the
// old window size. Throttled to one recompute per animation frame so a
// resize drag doesn't spam layout thrash.
let padFitResizeRaf = null;
window.addEventListener('resize', () => {
  if (padFitResizeRaf) return;
  padFitResizeRaf = requestAnimationFrame(() => {
    padFitResizeRaf = null;
    fitAllPadFileTexts();
  });
});

// ---- Rail nav ----

document.querySelectorAll('.c1-rail-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ---- Init ----

// Settings (disabled subcategories, "Audition on reroll") and export
// readiness must both be known before the first render, or the Types tab and
// export button would flash their defaults and then jump — see
// updateExportButtonState and the disabledSubcats-driven checkbox rendering
// in renderTypesPanel above.
async function init() {
  const [settings, exportStatus] = await Promise.all([
    window.ddw.settings.getAll(),
    window.ddw.export.status()
  ]);
  disabledSubcats = new Set(settings.disabledSubcats || []);
  document.getElementById('audition-chk').checked = settings.auditionOnReroll ?? true;
  skeletonReady = !!exportStatus.skeletonAvailable;

  switchTab('types');
  renderGrid();
  window.ddw.packs.list().then(packs => {
    currentPacks = packs;
    if (activeTab === 'folder') renderFolderPanel();
  });
  refreshLibraryStats();

  // v1.1.0: the M4L device can be loaded/removed from the Live track at any
  // time while this window is open, so status is polled rather than checked
  // once — 4s balances catching that promptly against pointless traffic to
  // a device that's usually just sitting idle.
  pollLiveStatus();
  setInterval(pollLiveStatus, 4000);
}

init();
