# DDW Drum Rack Generator

Scans a sample library, classifies samples by type and category, and
generates a randomized, lockable 16-pad Ableton Drum Rack that exports as a
real `.adg` file you drag into Live.

## Status: v1.2.1

Full feature set is in place:

- **Packs tab** — add sample folders via a native picker or drag-and-drop.
  Scanning is recursive and incremental (only new/changed files are
  re-parsed), reads WAV/AIFF headers for duration/sample rate without
  decoding audio, and keeps a persistent sqlite index. A pack that fails to
  scan (bad permissions, a path that disappears mid-walk) doesn't block the
  rest of the batch — it's reported in the status line and the others still
  scan.
- **Rules tab** — every sample is auto-categorized (kick, snare, clap, rim,
  tom, hat, crash, perc) by matching aliases against its filename and parent
  folder; edit aliases or a category's max length here, or reset to
  defaults.
- **Types tab** — every sample also gets a Type (One-Shot, Loop, Other) and
  a subcategory. Each type's cut-off stepper actually filters the counts,
  and per-subcategory checkboxes gate which subcategories the reroll engine
  can draw from — both persist across relaunches.
- **Pad grid** — each of the 16 pads is pinned to a One-Shot subcategory
  (e.g. all three TOM pads draw from "toms"), but that's now changeable per
  pad: its category tag is a dropdown, so a pad can be reassigned to a
  different subcategory (clearing its current sample) instead of only
  rerolling within its original role. The dice button and "Reroll all" draw
  a weighted-random matching sample honoring the Types tab's filters; locked
  pads are skipped and never duplicate a sample already used elsewhere in
  the same roll. Clicking a pad auditions it via Web Audio; an unfilled pad
  reads "— no sample —" rather than looking like it already has one loaded.
  A long sample name shrinks its own font to fit rather than ever resizing
  the pad itself.
- **Export .adg** — writes a real Ableton Drum Rack preset via a native save
  dialog, patched from a local structural template (see "One-time setup"
  below). Stays disabled, with an accurate tooltip, until the template is
  built and at least one pad has a sample — any pad left unfilled exports as
  an empty/unassigned slot rather than blocking the whole export.
- **Send to Rack** *(optional, needs Max for Live)* — once the
  `m4l/DDW Drum Rack Generator.amxd` device is loaded on the same MIDI
  track as a Drum Rack, a **Send to Rack** button appears next to
  Export .adg and pushes the current roll straight into that Drum Rack's
  pads — no file, no drag. See "Max for Live bridge" below.
- **Settings tab** — set a default folder for "Export .adg"'s save dialog,
  and recover from a corrupted `library.db` with "Reset library database"
  (clears the sample index only; your pack folders and sample files on disk
  are untouched — re-add and rescan them afterward to rebuild it).

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for what's
done, what's open, and the reasoning behind each version's decisions, and
[`App Changes Tracker.html`](App%20Changes%20Tracker.html) for the permanent
version-by-version changelog. [`docs/DESIGN.md`](docs/DESIGN.md) covers the
UI design system.

## Running it

```bash
npm install
npm run build:skeleton
npm start
```

`build:skeleton` is a one-time local step: it derives
`electron/export/skeleton.adg` (the structural template `.adg` export
patches per-pad) from an Ableton Live Pack drum rack already on this
machine, stripping the pack's own identity out of it first. It's gitignored
and gets regenerated locally rather than committed — see
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)'s v0.6.0 notes.
The app runs fine without it; only "Export .adg" needs it.

No native build tools are required — the library index uses Node's
built-in `node:sqlite`, not a compiled native module.

## Building an installer

```bash
npm run build:skeleton   # if not already done
npm run dist:win
```

Produces `dist/DDW Drum Rack Generator Setup <version>.exe`, a standard NSIS
installer (electron-builder), including a "choose install directory"
prompt, using the icon at `build/icon.ico`.

**This installer is for personal use on your own machine, not for
redistribution.** If `electron/export/skeleton.adg` exists when you run
`dist:win`, it gets bundled into the installer — and that file is derived
from your own licensed Ableton Live Pack content (see `build:skeleton`
above). That's fine for a copy you run yourself, but don't share the
built `.exe` with anyone else.

## Max for Live bridge

Entirely optional — the app works exactly as before without it, and this
section only matters if you have Max for Live and want to skip the
export-then-drag step.

1. Put a Drum Rack on a MIDI track in Live, with all 16 pads already holding
   a Simpler (any samples — this is a one-time setup step; a rack you
   already exported with this app works, or any factory kit).
2. In Live's browser, add this repo's `m4l/` folder as a Places entry
   (**Add Folder...** at the bottom of Places), then double-click
   `DDW Drum Rack Generator.amxd` to load it onto that same track.
3. Back in this app, once the device reports the rack is ready (a small
   indicator reads `<rack name> — 16/16 pads`), **Send to Rack** appears
   next to **Export .adg**. Reroll, then click it — all 16 pads update in
   Live immediately.

If the rack has fewer than 16 populated pads, the button explains that and
stays disabled — export a `.adg` once and drag it onto the track to get to
16/16, and every reroll after that can go straight through the bridge.

## Project layout

```
electron/
  main.js       Window creation, IPC handlers
  preload.js    contextBridge API surface exposed to the renderer
  db/           node:sqlite-backed library index (packs, samples, category rules, type cut-offs, settings)
  scanner/      Recursive folder walk + WAV/AIFF header parsing
  classify/     Category alias matching + Type/subcategory classification
  export/       .adg template patching (skeleton.adg is gitignored, see above)
  bridge/       Client for the optional Max for Live bridge (see below)
src/            Renderer: the device UI (tokens.css, device.css, renderer.js)
m4l/            The optional Max for Live device (see "Max for Live bridge" below)
docs/           DESIGN.md (design system spec) and IMPLEMENTATION_PLAN.md (living plan)
App Changes Tracker.html   Append-only version history — never edit past entries
```

## Requirements

- Ableton Live 12 (any edition) — the generated `.adg` is a standard Drum
  Rack preset, no Max for Live required to use the output.
- Optional: Max for Live, only for the "Send to Rack" bridge (see above) —
  and specifically Live 12.4+, since it depends on a Live API call that
  doesn't exist in earlier versions.
- Windows (current target platform).
