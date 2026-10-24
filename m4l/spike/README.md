# Phase 0 spike: does `replace_sample` actually work here?

**Result: yes — confirmed working on this machine's Live 12.4.5b11.**
Clicking the `bang` message box in `DDW-spike-device.amxd` swapped pad C1's
Simpler sample from "1 Kick C#" to the file named in `TEST_SAMPLE_PATH`,
instantly, with no dialog and no drag — verified both in the Simpler's own
title bar and in the Drum Rack's pad label. This is the gate for the rest of
v1.1.0, and it passed. `DDW-spike-device.amxd` is the actual proof artifact;
keep it as a working reference.

## Why this exists as a pre-built `.amxd` instead of GUI instructions

The original plan was to paste `replace-sample-test.js` into a `v8` object
via Max's editor, driven interactively. That path turned out to be a dead
end in this environment specifically: Live's embedded Max-for-Live editor
window is a separate OS process from the ordinary "Max 9" application, isn't
individually grantable, and its keyboard input gets silently blocked or
misdirected. Several attempts at typing into it landed keystrokes on Live's
own browser panel instead and loaded unrelated tutorial devices onto the
track by accident.

The fix: build the `.amxd` directly. A `.amxd`/`.maxpat` file is a small
binary wrapper (three chunks — `ampf`, `meta`, `ptch`) around a plain-text
JSON patcher body. `DDW-spike-patcher.json` in this folder is that JSON body
on its own (readable/editable), and `DDW-spike-device.amxd` is it wrapped
with the correct chunk header (12 + 12 + 8 header bytes, then the JSON, with
the `ptch` chunk's 4-byte little-endian length field matching the JSON's
byte length exactly). The patcher just wires a **message box reading `bang`**
to a **`v8 replace-sample-test.js`** object — the `v8` object loads the
script from disk by filename because Max always searches a patcher's own
folder for referenced files, so the script and the device sit side by side
here. No code is embedded in the `.amxd` itself.

This sidesteps the editor entirely: load the `.amxd` from Live's own
**browser** (a normal file load, not "Edit in Max"), and every object in it
renders directly in Live's compact device panel — including the message
box, which is mouse-clickable right there. No typing into Max required at
any point.

(An earlier version wired `loadbang` instead of a clickable message box, so
the test would fire the instant the device loaded. That produced no console
output at all — the JS engine inside a fresh `v8` object apparently isn't
ready yet the instant `loadbang` fires, so the bang arrives before anything
is listening. A manually-clicked message box sidesteps that timing issue
entirely, which is why the shipped version uses one.)

## Reproducing this yourself

1. In Live, put a Drum Rack on a MIDI track with at least one pad already
   holding a Simpler + sample (any sample — this mirrors DDW's own racks,
   which always start fully populated).
2. Add the folder this README lives in as a Places entry in Live's browser
   (**Add Folder...** at the bottom of the Places list), then double-click
   `DDW-spike-device.amxd` to load it onto that same track.
3. Before clicking `bang`, open `replace-sample-test.js` and check
   `TEST_SAMPLE_PATH` points at a real file on your machine (forward
   slashes). Re-load the device (delete + re-add from the browser) if you
   change it — Live seems to hot-reload an already-loaded device from disk
   in some cases but don't rely on that.
4. Click the `bang` message box directly in Live's device panel.
5. Check the pad: its Simpler should now show the new sample's name.

## Reading the result

Every step of `runTest()` in `replace-sample-test.js` posts a line prefixed
`DDW spike:` to the Max Console, so a failure names exactly where it
stopped (no Drum Rack found, pad empty, pad isn't a Simpler, etc.) rather
than failing silently. Getting the console itself to render in a screenshot
tool may hit the same GPU-compositing quirk mentioned above — the
Drum Rack pad's label and the Simpler's own title bar are the reliable way
to confirm success visually, and don't have that problem.

- **Success**: the target pad's Simpler title bar and pad label change to
  the new sample's filename, with nothing but the one `bang` click — no
  dialog, no drag.
- **Failure**: whatever the last `DDW spike:` console line says is the
  blocker (the `replace_sample` release note doesn't specify exact
  argument/return behavior, so some trial and error was expected — it
  wasn't needed here, but keep this in mind if it stops working on a
  different Live version).
