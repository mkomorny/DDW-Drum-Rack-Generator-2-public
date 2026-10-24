const { contextBridge, ipcRenderer, webUtils } = require('electron');

// v0.2.0 added folder picker, drag-and-drop path resolution, and scan
// progress. v0.3.0 added rules (category alias editing) and info (real
// candidate counts). v0.4.0 added types (real per-type/subcategory counts
// and a persisted, real cut-off per type). v0.5.0 added reroll (weighted
// random sample pick per pad) and audio (reads a sample's bytes for Web
// Audio audition — the renderer has no direct fs access under
// contextIsolation). v0.6.0 adds export (writes a real .adg via a native
// save dialog). v1.1.0 adds live (status/send for the optional Max for Live
// bridge — see electron/bridge/client.js; a no-op no-connection status when
// no device is loaded, so standalone use is unaffected). Only specific named
// channels are wired up — the renderer never gets a raw ipcRenderer handle,
// so it can't invoke or listen on anything beyond what's explicitly bridged
// below.

contextBridge.exposeInMainWorld('ddw', {
  version: process.env.npm_package_version || null,

  packs: {
    list: () => ipcRenderer.invoke('packs:list'),
    add: () => ipcRenderer.invoke('packs:add'),
    addPaths: (paths) => ipcRenderer.invoke('packs:add-paths', paths),
    remove: (id) => ipcRenderer.invoke('packs:remove', id),
    rescanAll: () => ipcRenderer.invoke('packs:rescan-all')
  },

  stats: {
    get: () => ipcRenderer.invoke('stats:get')
  },

  settings: {
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    chooseExportDir: () => ipcRenderer.invoke('settings:choose-export-dir'),
    clearExportDir: () => ipcRenderer.invoke('settings:clear-export-dir')
  },

  db: {
    reset: () => ipcRenderer.invoke('db:reset')
  },

  rules: {
    list: () => ipcRenderer.invoke('rules:list'),
    update: (id, patch) => ipcRenderer.invoke('rules:update', id, patch),
    reset: (id) => ipcRenderer.invoke('rules:reset', id),
    resetAll: () => ipcRenderer.invoke('rules:reset-all')
  },

  info: {
    counts: () => ipcRenderer.invoke('info:counts')
  },

  types: {
    list: () => ipcRenderer.invoke('types:list'),
    updateCutoff: (typeId, value) => ipcRenderer.invoke('types:cutoff-update', typeId, value)
  },

  reroll: {
    all: (pads, disabledSubcatKeys) => ipcRenderer.invoke('reroll:all', pads, disabledSubcatKeys),
    one: (pad, otherSampleIds, disabledSubcatKeys) => ipcRenderer.invoke('reroll:one', pad, otherSampleIds, disabledSubcatKeys)
  },

  audio: {
    read: (path) => ipcRenderer.invoke('audio:read', path)
  },

  export: {
    status: () => ipcRenderer.invoke('export:status'),
    adg: (pads) => ipcRenderer.invoke('export:adg', pads)
  },

  live: {
    status: () => ipcRenderer.invoke('live:status'),
    send: (pads) => ipcRenderer.invoke('live:send', pads)
  },

  onScanProgress: (callback) => {
    ipcRenderer.on('scan:progress', (_event, progress) => callback(progress));
  },

  // Dropped File objects don't carry a usable filesystem path across
  // contextIsolation by design; webUtils.getPathForFile is the sanctioned
  // Electron API for recovering it, and it only works from the
  // preload/renderer side (main has no File object to resolve).
  getDroppedPath: (file) => webUtils.getPathForFile(file)
});
