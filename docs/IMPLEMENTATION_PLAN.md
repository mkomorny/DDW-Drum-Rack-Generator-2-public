# Implementation Plan — DDW Drum Rack Generator

Living plan, updated in place each pass. Completed items are marked with
the version they shipped in and left intact — this file is never reset.
Full architectural rationale and the original approved plan live at
`C:\Users\<you>\.claude\plans\okay-i-want-to-dynamic-bentley.md`.

## Hard constraints (this project, ongoing)

- `App Changes Tracker.html` is append-only — never edit or delete prior entries, never delete the file.
- Secrets/settings may live in the project folder but must be gitignored and never pushed.
- GitHub: private repo `DDW Drum Rack Generator 2`.

## Build steps

### v0.1.0 — Repo init, design system, static device shell — ✅ done in v0.1.0
- [x] Electron scaffold (`electron/main.js`, `electron/preload.js`), contextIsolation on, nodeIntegration off, sandboxed.
- [x] `docs/DESIGN.md` — full design-token extraction and rationale.
- [x] `src/tokens.css` + `src/device.css` — device chrome rebuilt from the spec, not copy-pasted.
- [x] All 4 rail tabs (Packs, Types, Rules, Info) render and switch live.
- [x] All 3 Type modes (One-Shots, Loops, Other) render with correct subcategory lists, counts, and cut-off steppers.
- [x] Pad note order corrected (see DESIGN.md) — verified 36→51 ascend bottom-to-top, left-to-right.
- [x] Verified live in a browser harness against the approved mockup: static content match, tab switching, dropdown change, filter checkbox toggle, stepper +/-, pad lock toggle.
- [x] `.gitignore` covers node_modules, build output, local DB/index files, and secrets before first commit.

### v0.1.1 — App Changes Tracker persistence fix — ✅ done in v0.1.1
- [x] `App Changes Tracker.html` called a nonexistent `window.storage` API and
      silently failed to save any entry when opened as a plain file — fixed
      to use `localStorage`.
- [x] Discovered `localStorage` under `file://` is unreliable/origin-fragile
      as a *permanent* record, which the Tracker's own "never delete, only
      add" rule requires. Redesigned: entries now live in a `SEED_ENTRIES`
      constant embedded in the file itself (git-tracked, portable, the real
      source of truth), with `localStorage` layered on top only for local
      convenience additions. Seed entries can't be edited or deleted
      through the UI — enforced in code, not just by convention.

### v0.2.0 — Folder ingestion + scanner core — ✅ done in v0.2.0
- [x] Packs tab live: native folder picker via IPC (`packs:add`), drag-and-drop
      of folders onto the drop zone, pack list with per-pack remove.
- [x] Recursive directory walk (`electron/scanner/walk.js`), async
      `fs.promises.opendir`-based, skips hidden files/dirs and symlinks.
- [x] WAV `fmt `/`data` chunk + AIFF `COMM` header parsing for duration
      without full decode (`electron/scanner/audioHeaders.js`) — including a
      from-scratch 80-bit IEEE extended-float decoder for AIFF's sample rate
      field. Verified against real WAV/AIFF fixtures with known durations,
      not just "it runs."
- [x] **Dependency swap from the original plan:** the index uses Node's
      built-in `node:sqlite` (`electron/db/index.js`), not `better-sqlite3`.
      This machine has no Visual Studio Build Tools, so `better-sqlite3`'s
      native addon can't be compiled against Electron's ABI here without an
      invasive multi-GB toolchain install. Electron 43 bundles Node 24,
      which ships `node:sqlite` (stable, no native compilation, no
      packaging risk later in v1.0.0) with equivalent capability for this
      project's needs — verified directly before committing to the swap.
- [x] Incremental rescan keyed on mtime+size — unchanged files are never
      re-parsed; changed files are reparsed and upserted; files gone from
      disk are pruned from the index.
- [x] Scanning is async/non-blocking (no worker thread needed — the work is
      I/O-bound header reads, not CPU-bound decode, so `fs.promises` +
      periodic `setImmediate` yields keep both the main process and the
      renderer responsive). Progress streamed to the renderer via batched
      `scan:progress` IPC events every 50 files.
- [x] Mid-panel packs/samples stats now reflect the real index via
      `stats:get`, replacing the v0.1.0 mock numbers.

### v0.3.0 — Categorization engine + Rules tab — ✅ done in v0.3.0
- [x] Default alias tables per category (`electron/classify/categories.js`) —
      8 built-in categories: kick, snare, clap, rim, tom, hat, crash, perc.
- [x] Filename + parent-folder matching (`electron/classify/matcher.js`) —
      case-insensitive substring match against the filename (extension
      stripped) and its immediate parent folder name, so a pack organized
      into subfolders (e.g. `Kicks/01.wav`) classifies correctly even with
      generic filenames.
- [x] Conflict resolution decided and implemented: **longest-alias-wins**
      (e.g. "rimshot" beats "rim" when both are substrings of the same
      filename), with the category's position in the rules array as an
      explicit priority order breaking any remaining tie between
      equal-length aliases from different categories.
- [x] Rules tab wired to real data via `window.ddw.rules` (`electron/db`
      `category_rules` table): edit aliases (persisted, triggers a full
      library re-categorize), edit max length (persisted, does not
      re-categorize — length isn't part of matching, see below), and reset
      one category to its default aliases/length.
- [x] Info tab shows real candidate counts via `window.ddw.info.counts()` —
      one row per category plus an "Uncategorized" row for samples that
      matched no alias.
- [x] New samples are categorized automatically right after a scan
      (`electron/classify/index.js`, called from `main.js` after
      `packs:add`/`packs:add-paths`/`packs:rescan-all`); editing or
      resetting aliases re-categorizes the whole library, not just new
      samples, since existing samples' classification can change too.
- [x] `samples.category_id` column + `category_rules` table added to the
      sqlite schema, with an idempotent migration
      (`ensureCategoryColumn`) so a v0.2.0-era `library.db` upgrades
      cleanly without the user needing to delete/rescan anything.

### v0.4.0 — Type classification + cut-offs — ✅ done in v0.4.0
- [x] Type + subcategory taxonomy (`electron/classify/typeCategories.js`):
      One-Shot's 7 subcategories map onto the v0.3.0 categories (snare+rim
      collapse into one "Snares & Rims" bucket); Loop's 6 and Other's 6 are
      alias-matched the same way the v0.3.0 category engine matches
      filenames, reusing `electron/classify/matcher.js` directly.
- [x] Classification decision order
      (`electron/classify/types.js` `classifySample`), run per sample:
      1. **Loop** — any Loop-subcategory alias matches the filename/parent
         folder, checked first so a "Kick_Loop_120.wav" isn't miscategorized
         as a Kicks one-shot just because it also matches "kick".
      2. **One-Shot** — the sample has a v0.3.0 `category_id` AND its
         duration is within that category's Rules-tab max length (or the
         duration is unknown — an unreadable header trusts the category
         match rather than punting to Other). This is what finally consumes
         `category_rules.max_len_ms`, persisted-but-unused since v0.3.0.
      3. **Other** — Other-subcategory alias match, else "Unclassified
         Filenames".
- [x] `samples.type_id` / `samples.subcategory_id` columns + `type_cutoffs`
      table added, with the same idempotent-migration pattern as v0.3.0's
      `category_id` column, so a v0.3.0-era `library.db` upgrades cleanly.
- [x] Types tab wired to real data via `window.ddw.types`: subcategory rows
      show real counts, and each type's cut-off stepper is persisted
      (`type_cutoffs`, editable, not just a client-side number) and actually
      filters those counts to samples at or under the cut-off — verified
      directly (a sample only enters/leaves a subcategory's count as the
      cut-off crosses its duration).
- [x] New/rescanned samples are type-classified automatically right after
      categorization (`main.js`, after `categorizeSamples`); editing a
      category's aliases *or* max length from the Rules tab re-runs type
      classification for the whole library (max length alone doesn't move a
      v0.3.0 category match, but does move a sample between One-Shot and
      Other here) — verified directly: shrinking a category's max length
      flipped a previously-One-Shot sample to Other/Unclassified.
- [x] Per-subcategory checkboxes remain a client-only "include in candidate
      pool" toggle (not persisted) — they don't do anything yet since the
      reroll engine that would consume them doesn't exist until v0.5.0; this
      matches how locks/dice/audition already report "not implemented"
      rather than faking behavior.

### v0.5.0 — Reroll engine, audition, locks — ✅ done in v0.5.0
- [x] **Pad-to-subcategory mapping decided:** each of the 16 pads is pinned
      to one of the 7 One-Shot subcategories (`electron/classify/typeCategories.js`)
      — the finest granularity the classifier actually tracks. RIDE and
      CRASH both draw from `cymbals`, TOM LOW/MID/HI all draw from `toms`,
      etc. — the pad's role label (`cat`/`catClass`) is fixed display text
      and never changes on reroll; only the sample assigned to it does.
- [x] Weighted random pick per pad (`electron/db/index.js` `getRerollCandidates`,
      `electron/main.js` `pickRerollCandidate`), filtered to `type_id =
      'oneshot'`, the pad's `subcategory_id`, and the Types tab's current
      One-Shot cut-off — same cut-off the Types tab counts already use.
      "Weighted" is uniform-random across that filtered pool; the plan
      doesn't call for weighting by pack size, recency, or anything else, so
      nothing beyond the filters was invented.
- [x] Per-subcategory checkboxes from v0.4.0 are now load-bearing: a
      disabled subcategory reports `reason: 'disabled'` and yields no
      candidates for any pad pinned to it.
- [x] Per-pad lock (`electron/main.js` `reroll:all`) — locked pads are
      skipped entirely and their current sample is held out of the pool for
      every other pad rerolled that pass; the dice button on a locked pad
      refuses to reroll it (`src/renderer.js` `rerollPad`).
- [x] No duplicate sample across pads in one roll — `reroll:all` tracks used
      sample ids across the whole batch (seeded with locked pads' current
      samples); `reroll:one` also excludes every sample currently on another
      pad, so a single-pad dice reroll can't collide with the rest of the
      rack either.
- [x] Web Audio audition (`electron/main.js` `audio:read` → `window.ddw.audio.read`
      → `AudioContext.decodeAudioData` in `src/renderer.js`). `audio:read`
      only serves paths already present in the library index — verified
      it refuses both an unindexed path and an arbitrary real filesystem
      path, not just a made-up one — so it can't become an arbitrary-file-read
      primitive from the renderer.
- [x] Clicking any pad auditions its current sample on demand, independent
      of the toggle. "Audition on reroll" (checked by default) auto-plays
      on an individual dice reroll; **Reroll All deliberately does not**
      auto-audition — playing up to 14 samples at once would just be noise,
      documented as a scope decision, not an oversight.
- [x] Verified via a mocked-Electron integration test against a real
      temporary sqlite database (same technique as v0.3.0/v0.4.0): cut-off
      filtering, exclude-already-used-ids, pool exhaustion (`reason:
      'empty'`), disabled-subcategory rejection, no-duplicate-across-pads
      for both `reroll:all` and `reroll:one`, a locked pad correctly
      removing its sample from the pool, and `audio:read`'s path allowlist.

### v0.6.0 — `.adg` export — ✅ done in v0.6.0
- [x] **Template source decided:** rather than requiring the user to
      manually export a fresh reference `.adg`, searched the user's own
      Ableton files directly — per their explicit redirect, specifically
      `A:\Samples_Packs\Ableton Live Packs` (not the User Library) — and
      selected `Drum Essentials\Drums\Drum Machines\505 Classic Kit.adg`
      (Live 12.0d1, plain-root `DrumGroupDevice`, 16 populated
      `DrumBranchPreset` blocks) out of a bulk scan of 2887 candidate `.adg`
      files, filtered to the 161 with an unwrapped root `DrumGroupDevice`
      (as opposed to a Rack-wrapping-a-Rack, or a Live-9-era schema too old
      to be Live-12-compatible).
- [x] **Schema reverse-engineered from the real file**, since the `.adg`/
      `.als` XML format is unofficial and undocumented: `DrumGroupDevice` →
      16 `DrumBranchPreset` → `OriginalSimpler` → `Player > MultiSampleMap >
      SampleParts > MultiSamplePart`, carrying `Name`, `SampleStart`/
      `SampleEnd` (sample frames, not ms), `SustainLoop`/`ReleaseLoop` `End`,
      and a `SampleRef` with two duplicate `FileRef` blocks (main +
      `SourceContext > OriginalFileRef`). `ReceivingNote` (the pad's MIDI
      trigger note) lives separately in the branch's `ZoneSettings`.
- [x] **External-file-reference pattern verified against real, working Live
      12.4.3 output**, not guessed: decompressed the user's own project
      `A:\Live Recordings\fixing racks Project\fixing racks.als`, which
      references a sample completely outside any Library/Pack, and confirmed
      the pattern (`RelativePathType=1`, `Type=1`, empty `LivePackName`/
      `LivePackId`, real absolute `Path`). `RelativePath` is left empty in
      export output rather than guessing at project-relative resolution
      semantics inside a standalone preset (no project folder to be relative
      to) — `Path` is the field verified load-critical in every real
      example, so it's always populated correctly; this is the one part of
      export that can only be fully confirmed by loading a generated file in
      real Live.
- [x] **Template shipped as a locally-built, content-neutral skeleton, not
      a committed copy of the source file:** `electron/export/buildSkeleton.js`
      (committed — pure transform code) strips every piece of the source
      pack's actual identity — pack name/id, sample names, sample file
      paths, the original creator's desktop username, tweaked macro-knob
      sound-design positions, and even a leaked personal path from the
      Return chain's stock-effect device lineage — leaving only Ableton's
      own mechanical device defaults (parameter ranges, on/off states,
      device chain shape) behind. Run once via `npm run build:skeleton`
      against the user's own legitimately-owned Live Pack file to produce
      `electron/export/skeleton.adg`, which is gitignored, not committed —
      same pattern this project already uses for local DB/settings files.
      The build script refuses to write output if any leftover
      identifying string survives a scan.
- [x] **Runtime patcher** (`electron/export/adg.js`): splits the skeleton's
      16 `DrumBranchPreset` blocks, and for each pad does scoped, byte-
      preserving string surgery (not a full XML re-serialize, to avoid any
      risk of subtle formatting drift an unofficial parser might be
      stricter about than the XML spec) inside just that branch's
      `<MultiSamplePart>...</MultiSamplePart>` — patching `Name`,
      `SampleEnd`/loop `End`s (computed from `duration_ms`/`sample_rate`
      already in the sqlite index), both `FileRef` blocks, `LastModDate`,
      `DefaultDuration`/`DefaultSampleRate`, and the branch's
      `ReceivingNote`.
- [x] **Export requires a fully-populated rack** (every pad has a sample) —
      the template schema always carries a real sample slot per branch, so
      an "empty pad" export path would need untested XML surgery to strip a
      `MultiSamplePart` out entirely; scoped out rather than guessed at.
      "Export .adg" stays disabled in the renderer until Reroll All (or
      per-pad rerolls) has filled all 16 pads.
- [x] **Save to disk** via a native save dialog (`export:adg` IPC handler,
      `dialog.showSaveDialog`), defaulting to `DDW Drum Rack.adg`. Saving
      straight into the Live User Library wasn't pursued — the save dialog
      already lets the user navigate there themselves, and guessing at the
      right User Library subfolder wasn't worth the added complexity.
- [x] Verified via a mocked-Electron integration test against a real
      temporary sqlite database (same technique as v0.3.0–v0.5.0): 16
      well-formed `DrumBranchPreset` blocks, correct `ReceivingNote` per
      pad, correct absolute `Path`/sample name per pad, frame-accurate
      `SampleEnd`/`DefaultDuration`, no leftover pack/personal content,
      incomplete-rack rejection, missing-file-on-disk rejection, and a
      cancelled save dialog reported without writing anything.

### v1.0.0 — Polish + packaging — ✅ done in v1.0.0
- [x] **Settings persistence** (`electron/db/index.js` `settings` table, a
      generic key/value store — `getSettings`/`setSetting`): the Types tab's
      disabled subcategories and the "Audition on reroll" toggle used to
      reset to defaults on every relaunch (flagged as an open item since
      v0.5.0); both now round-trip through `window.ddw.settings` and are
      loaded before the first render (`src/renderer.js` `init()`), so the
      Types tab and the checkbox don't flash defaults and then jump. Pad
      grid state (locks, assigned samples) is deliberately **not**
      persisted — regenerating the rack each launch is the point of the
      app, not a gap.
- [x] **Error/empty states:**
  - A single pack failing to scan (permission denied, a path that vanishes
    mid-walk) no longer aborts the whole add/rescan batch or leaves an
    unhandled IPC rejection in the renderer — `electron/main.js`
    `scanPacksSafely` catches per-pack and reports the failure over the
    existing `scan:progress` channel (`{ done: true, error }`), and the
    remaining packs still scan. The renderer surfaces it as a status message
    instead of failing silently.
  - The folder-picker and drag-and-drop add flows (`src/renderer.js`) now
    catch a rejected `window.ddw.packs.add()`/`addPaths()` and report it via
    `setStatus` instead of an unhandled promise rejection.
  - The export button's disabled state/tooltip now reflects
    `skeleton.adg`'s availability **proactively at startup**
    (`window.ddw.export.status()`, checked in `init()`), not just after a
    failed export click — a user who hasn't run `npm run build:skeleton` yet
    sees the real reason immediately.
  - An unfilled pad (before the first reroll, or a fresh install) now reads
    "— no sample —" in dimmed/italic text instead of one of the approved
    mockup's placeholder filenames (e.g. "Fat_Punchy_Kick.wav") — the old
    behavior looked like a real sample was already loaded on every pad on
    first launch, which it never was.
- [x] **Windows installer:** `electron-builder` (devDependency), configured
      via `package.json`'s `build` key for an NSIS installer
      (`npm run dist:win` → `dist/DDW Drum Rack Generator Setup 1.0.0.exe`).
      Verified end-to-end in this environment — the installer actually
      built (~99 MB, expected given bundled Chromium/Electron). No custom
      app icon; electron-builder falls back to the default Electron icon
      (cosmetic gap, not pursued — see dev notes). `dist/` was already
      gitignored (build output), so nothing new needed there. **Bundles
      `electron/export/skeleton.adg` if present at build time** — the
      installer is for the user's own personal use on their own machine
      (same person who owns the Live Pack license), not for redistribution;
      see the copyright-caution rationale under v0.6.0 above, which applies
      even more directly to a packaged installer than to the dev-only
      `skeleton.adg` file.
  - [x] README rewrite: pruned the v0.2.0–v0.6.0 per-version status
      paragraphs (that history now lives permanently in `App Changes
      Tracker.html`, per this project's documentation rules) down to a
      single current-state description, and added a "Building an installer"
      section.

### v1.0.1 — Pad-grid overflow fix + custom app icon — ✅ done in v1.0.1
- [x] **Pad-grid overflow bug fixed.** `.c1-grid` sits in `.c1-layout`'s `1fr`
      column, but a grid item's implicit `min-width: auto` means it refuses
      to shrink below its own content's width — at the v1.0.0 default window
      size, the pad grid's natural width exceeded the space actually left
      for it, so it overflowed past the window edge, and `overflow: hidden`
      on `body` silently clipped the 4th pad column instead of showing a
      scrollbar. Found from a real screenshot the user sent at the default
      900×620 size. Fixed with `min-width: 0` on `.c1-grid` (`src/device.css`)
      so the track actually honors its `1fr` sizing, plus bumped the default
      window to 1120×660 and the resize floor from 760 to 980
      (`electron/main.js`) — 760 was already narrower than the fixed
      rail+panel+mid columns need, guaranteed to clip regardless of the grid
      fix.
- [x] **Custom app icon** (open item since v1.0.0): a flat drum-and-crossed-
      sticks glyph built from the app's own design tokens (`--accent`/
      `--accent-hover` amber, `--surface-frame` dark backdrop, `--text`
      white sticks) so it reads as the same product as the device UI.
      Authored as an SVG source (`build/icon.svg`, committed) and rasterized
      to a multi-resolution `.ico` (16–256px) with a one-off `sharp` +
      `png-to-ico` script run outside the project (not added as project
      dependencies — this isn't part of the ongoing build, just how the
      `.ico` got made once). Wired into `package.json`'s `build.win.icon`
      (packaged installer) and `electron/main.js`'s `BrowserWindow` `icon`
      option (dev-run window/taskbar); `npm run dist:win` rebuilt end-to-end
      to confirm the icon path resolves.
- [x] **`.gitignore` bug fixed.** `build/` was lumped in with `dist/`/`out/`
      as build output in an earlier pass, but electron-builder's own
      convention uses `build/icon.ico`/`build/icon.png` as a *source* path
      it reads from, not something it writes — nothing had ever been added
      there before now so this never surfaced. Un-ignored `build/`; the
      three new icon assets are committed.

### v1.1.0 — Max for Live bridge ("Send to Rack") — ✅ done in v1.1.0
- [x] **Phase 0 spike confirmed the whole idea was viable**, before any real
      code: a throwaway `v8` object calling `SimplerDevice.replace_sample`
      with a hardcoded path visibly swapped a Drum Rack pad's sample on this
      machine's Live 12.4.5b11 — see `m4l/spike/README.md`.
- [x] **Device type corrected mid-plan:** the user pointed at a reference
      manual for a similarly-named third-party device and flagged that the
      original spike used a Max **Audio** Effect; the correct, working type
      is a Max **MIDI** Effect (lives on a MIDI track, alongside the Drum
      Rack it targets) — every `.amxd` in this project uses that type.
- [x] **`.amxd` files are hand-authored, not built in the Max editor.**
      Live's embedded Max-for-Live editor process can't be reliably
      automated in this environment (see dev notes) — keyboard input is
      intermittently blocked and full-window screenshots render solid
      black. Worked around entirely: a `.amxd` is just three binary chunks
      (`ampf`, `meta`, `ptch`) wrapping a plain-text JSON patcher body, so
      `m4l/DDW-bridge-patcher.json` is hand-edited and a small Node script
      wraps it into the real `.amxd` — loaded into Live via the browser
      (Add Folder + double-click), never via "Edit in Max" or copy/paste.
- [x] **`electron/export/resolvePads.js`** — the pad-id-to-{path, duration,
      sample rate, ...} resolution loop, previously inlined in the
      `export:adg` handler, extracted into a shared function. Both the
      `.adg` writer and the new bridge call it, so a `.adg` export and a
      live "Send to Rack" can never disagree about what a pad resolves to.
- [x] **`electron/bridge/client.js`** — reads/validates the handshake file
      the M4L device writes to this app's own `appData` folder (a fixed,
      OS-derived path independent of this app's dev-vs-packaged name, see
      the file's own comment), exposes `status()`/`send()` over plain
      `http` to 127.0.0.1, and treats a missing file, a dead `pid`, or a
      refused connection as "not connected" rather than an error.
- [x] **`live:status`/`live:send` IPC + `window.ddw.live`** wired the same
      way every other channel is (`electron/main.js`, `electron/preload.js`).
- [x] **Renderer UI** (`src/renderer.js`, `src/index.html`, `src/device.css`):
      a **Send to Rack** button (accent-styled, like Reroll All) appears
      only once `live.status()` reports a connected device, alongside a
      small connection indicator (`rack name — N/16 pads`); **Export .adg**
      is unchanged and always present. Status is polled every 4s
      (`pollLiveStatus`) so the button appears/disappears live as the
      device is loaded/removed from the track, with no page reload needed.
      Verified through every state transition (disconnected → connected +
      incomplete rack → connected + ready → sent → disconnected again)
      against the real `renderer.js` in a browser harness with a mocked
      `window.ddw.live` (same technique as the existing browser-preview
      artifact) before ever touching Live.
- [x] **`m4l/ddw-bridge.js`** (Node for Max, runs in a `node.script` object)
      — owns the HTTP server (127.0.0.1, random per-launch token required
      via `X-DDW-Token`), the handshake file's lifecycle, and best-effort
      launching/focusing the standalone app (`open_ddw` message, guesses
      electron-builder's default per-user NSIS install path from this
      project's own `package.json` `build` config — not yet verified
      against a real install, since `dist:win` hasn't been re-run since
      v1.0.1). Correlates every request with `ddw-live.js`'s reply via a
      request id, same pattern the original plan called for.
- [x] **`m4l/ddw-live.js`** (`v8` object — the only place in the whole
      device allowed to touch the Live API) — generalizes
      `m4l/spike/replace-sample-test.js` from one hardcoded pad to all 16
      (notes 36–51, matching `PAD_DATA` in `src/renderer.js`): resolves the
      Drum Rack on the hosting track, reports per-note readiness
      (`class_name === 'OriginalSimpler'` per populated pad) for `/status`,
      and calls `replace_sample` per pad for `/load`, continuing past a
      single pad's failure so one bad path can't block the other 15.
- [x] **Verified end-to-end against the real, shipped files** (not the
      spike): loaded `m4l/DDW Drum Rack Generator.amxd` onto a MIDI track
      with a factory-populated Drum Rack, queried `/status` and `/load`
      directly over HTTP with the real handshake token, and visually
      confirmed all 16 pads' Simplers swapped to the sent sample — both via
      the Simpler's own title bar and the Drum Rack's pad grid labels.
- [x] **`node.script` requires `autostart: 1`.** The default Max for Live
      device template's `node.script` box doesn't run its script until it
      either gets an explicit `script start` message or the box's
      `saved_object_attributes.autostart` is `1` — omitting this was the
      single blocker between "device loads with no errors" and "the bridge
      actually does anything," and it fails **silently**: no console
      output, no error styling on the box, nothing wrong-looking in the
      patcher at all. Every `.amxd` in this project sets it explicitly.

### v1.2.0 — Partial export, pad retyping, no-resize pad grid, Settings tab — ✅ done in v1.2.0
- [x] **Export/Send to Rack no longer require every pad filled.** Previously
      both were disabled until all 16 pads had a sample; now only a
      completely empty rack (0/16) blocks them.
      `electron/export/resolvePads.js` short-circuits a pad with no
      `sampleId` to `{ note, samplePath: null }` instead of a DB lookup;
      `electron/export/adg.js`'s new `patchEmptyBranch` writes that pad's
      `<DrumBranchPreset>` branch back out exactly as the skeleton's own
      pristine, never-patched state (`RelativePathType="0"`, empty `Path`,
      `Type="2"`, zeroed duration/sample rate) — reusing the skeleton's
      existing "unassigned" representation rather than inventing new XML for
      "empty." `electron/bridge/client.js`'s `/load` request simply omits
      unfilled pads entirely rather than sending a "clear" instruction, so
      the corresponding Live pad is left holding whatever it already had.
      `electron/main.js`'s gate on both `export:adg` and `live:send` changed
      from "any pad missing" to "every pad missing." Verified with a direct
      Node-level test of `buildAdgBuffer` against a mixed filled/unfilled
      pad set.
- [x] **Pad retyping.** Each pad's category tag (`src/renderer.js`
      `renderGrid`) is now a live `<select>` (`SUBCATEGORY_META`/
      `SUBCATEGORY_ORDER`, the same 7 One-Shot subcategories the classifier
      has always tracked) instead of fixed display text — a pad can be
      reassigned to a different subcategory after the fact, not just
      rerolled within the role it started with. Changing it
      (`retypePad`) clears the pad's current sample (a sample matched to the
      old subcategory has no guarantee of fitting the new one), leaving it
      "— no sample —" until rerolled, same as a freshly unlocked pad.
- [x] **Pad grid never resizes; the text does.** Two long-standing CSS
      issues fixed together: (1) `.c1-grid`'s `grid-template-columns`/`rows`
      moved from bare `repeat(4, 1fr)` to `repeat(4, minmax(0, 1fr))`, with
      explicit `min-width`/`min-height: 0` down the `.c1-mid`/`.c1-pad`
      ancestor chain — a bare `1fr` track still has a content-based
      automatic minimum, so one pad with a long sample name could inflate
      the whole grid past the fixed window regardless of anything done to
      the text inside it. (2) `.c1-pad-file` changed from
      `white-space: nowrap` truncation to `flex: 1 1 auto; min-height: 0` so
      it exactly fills the leftover space between `.c1-pad-top`/
      `.c1-pad-bottom` (now pinned to `flex: 0 0 auto`), and a new
      `fitPadFileText`/`fitAllPadFileTexts` pair in `src/renderer.js`
      measures each pad's rendered text after every grid render (and on
      window resize, throttled to one recompute per animation frame) and
      steps its `font-size` down in 0.5px increments until it stops
      overflowing that fixed box — falling back to trimming characters and
      appending "…" only if it's still overflowing at a 6px readability
      floor. CSS alone can't make a per-element "does this text fit at this
      size" decision, so this is JS by necessity, not preference. Verified
      both visually and via DOM measurement in a standalone browser test
      harness (created, used, then deleted — no trace in the tracked diff)
      before this pass, then re-verified against the new shrink-to-fit
      approach.
- [x] **Settings tab** (new 5th rail button, `src/index.html`/`device.css`/
      `renderer.js`, `electron/main.js`/`preload.js`): a **default export
      folder** (native folder picker via a new `settings:choose-export-dir`
      IPC handler, persisted through the existing generic settings
      key/value store, used as `export:adg`'s `showSaveDialog` `defaultPath`
      instead of always defaulting to Documents), and a **Reset library
      database** action (`db:reset` IPC handler) for recovering from a
      corrupted `library.db` from inside the app — closes the db, deletes
      `library.db` plus its `-wal`/`-shm` WAL sidecars, and lets
      `electron/db/index.js`'s existing lazy `getDb()` recreate a fresh one
      on next access. Only the sqlite index is destroyed; pack folders and
      sample files on disk are untouched, so re-adding/rescanning rebuilds
      it. Confirmed via `PRAGMA integrity_check`-style diagnosis earlier
      this pass that a real corrupted `library.db` on this machine has
      page-level corruption isolated to the `samples` table (consistent
      with an interrupted write, not anything the app did) — the reset
      button exists now, but resetting *that specific* file is still owed
      as a manual step (see Open items) since the app had 13 instances open
      and Windows holds the file locked while any of them do.
- [x] **M4L device presentation-mode UI.** `m4l/DDW-bridge-patcher.json`
      (and the wrapped `m4l/DDW Drum Rack Generator.amxd`) gained
      `openinpresentation: 1` plus three presentation-mode objects — a title
      comment, a status `live.comment` ("Rack status shows in the DDW app
      window."), and an `Open DDW` `live.text` button wired to the existing
      `obj-20` — so the device shows a real, minimal presentation view
      instead of its full unarranged patcher when collapsed onto a track.
      Carried over from earlier in this same unreleased delta; bundled into
      this version rather than shipped separately since nothing had been
      tagged since v1.1.0.
- [x] **Bugfix: `.c1-cat-select` naming collision.** The Rules tab's
      category dropdown and the new-this-pass pad-grid retype `<select>`
      both used the class `c1-cat-select`; the pad's pill styling (small,
      uppercase, custom chevron) was declared later in `device.css` and
      silently won the cascade, shrinking the Rules tab's intended
      full-width dropdown down to pill size. Renamed the pad one to
      `c1-pad-cat-select` (`renderer.js` + `device.css`) to separate them
      for good.

### v1.2.1 — Bugfix: status-box overflow, default pack-add folder — ✅ done in v1.2.1

- [x] **Root cause found for "v1.2.0 changes aren't showing up."** Not a code
      bug — the `.amxd` device's "Open DDW" button (`m4l/ddw-bridge.js`)
      launches whatever `.exe` is installed at
      `%LOCALAPPDATA%\Programs\DDW Drum Rack Generator\`, not the source
      tree. `npm run dist:win` had last been run at 11:17am that day,
      producing a v1.1.0 installer — *before* the v1.2.0 commit landed later
      that day — so the installed app was an hour stale and none of v1.2.0's
      UI changes (Settings tab, pad-text-shrink, pad category retype) could
      possibly have appeared no matter how correct the source was. Confirmed
      by diffing `m4l/ddw-bridge.js`/`ddw-live.js`/the `.amxd` itself against
      the copies in the user's Live User Library (byte-identical — the M4L
      side was never the problem) and by checking `dist/latest.yml`
      (`version: 1.1.0`, stale). Fixed by rebuilding
      (`npm run dist:win` → `DDW Drum Rack Generator Setup 1.2.1.exe`,
      folded straight into this version rather than re-releasing 1.2.0) and
      reinstalling; verified the fix by grepping the installed `app.asar` for
      `rail-btn-settings`/`fitPadFileText`/`c1-pad-cat-select` and finding
      all three present. **Process gap closed:** the git commit/tag/push
      ritual alone does not ship a fix to the running app — every pass that
      touches `src/` or `electron/` now also rebuilds the installer and
      reinstalls, not just pushes to GitHub.
- [x] **Bugfix: Settings tab status message overflowed into the pad grid.**
      `.c1-status` (`device.css`) had no wrap rule, and a folder path like
      `A:\User Library\Presets\Instruments\Dr Rack` has no spaces, so the
      browser treated it as one unbreakable token and rendered it straight
      out of `.c1-mid`'s fixed 160px grid column into `.c1-grid` next to it,
      visibly overlapping pad C1. Same root cause as the pad-text overflow
      fixed in v1.2.0, just a different element that hadn't gotten the same
      treatment yet. Fixed with `overflow-wrap: anywhere` on `.c1-status`.
- [x] **Default folder for "add sample pack" now opens to `A:\Samples_Packs`**
      instead of the OS default (Documents/last-used). `electron/main.js`'s
      `packs:add` handler's `dialog.showOpenDialog` call gained
      `defaultPath: 'A:\\Samples_Packs'`. Hardcoded rather than a Settings-tab
      option, per the request — this mirrors the existing `exportDir`
      pattern's *fallback* value, not its user-configurable path; can become
      a real setting later if that's wanted.

## Open items

- ~~**Export needs a real Live test.**~~ **Resolved 2026-08-25** —
  confirmed on the user's real machine: a generated `.adg` drags into Live
  12 and all pads load and trigger correctly, including the empty
  `RelativePath` case resolving without a relink prompt.
- ~~**Installer built but not run.**~~ **Resolved in v1.2.1** — the
  installer has since been built, run, and reinstalled multiple times on
  the user's real machine, and verified post-install by grepping the
  installed `app.asar` for feature markers.
- MP3/FLAC/OGG duration parsing deferred — WAV/AIFF only until a format decision is made.
- Loops cut-off is in bars, which needs a real tempo source (filename-embedded BPM vs. a user-set project tempo vs. both) — as of v0.4.0 it's no longer display-only (it really filters the Loop subcategory counts), but the bars→ms conversion still uses a fixed 120 BPM / 4-4 (2s per bar) placeholder rather than a per-sample or per-project tempo, see `DESIGN.md`.
- Reroll pulls only from `type_id = 'oneshot'` — the pad grid has no pads
  wired to Loop or Other candidates, since the approved mockup's 16-pad
  layout is a one-shot drum rack. Not a gap, just worth noting explicitly
  since it wasn't a deliberate exclusion call-out until this pass.
- ~~**`open_ddw`'s install-path guess is unverified against a real
  install.**~~ **Resolved in v1.2.1** — confirmed against the user's real
  `perMachine: false` NSIS install; `findDdwExe()`'s guessed path matched
  and successfully launched the app.
- ~~**Send to Rack needs a real end-to-end Live test.**~~ **Resolved
  2026-08-25** — confirmed working on the user's real machine: the bridge
  connected, `padsReady` reported correctly, and clicking Send to Rack
  visibly swapped samples into the live Drum Rack's pads. Along the way,
  the handshake file (`bridge.json`) was observed briefly disappearing
  between polls (the device unloading/reloading, not a code issue) and the
  rack's `padsReady` sitting at 0 until enough of its pads were genuine
  `OriginalSimpler` devices — both consistent with the documented design,
  not bugs.
- **Two Drum Racks on one track, or Drum Sampler pads** — `ddw-live.js`
  picks the first `DrumGroupDevice` it finds and reports `not-simpler` for
  any pad that isn't an `OriginalSimpler`; both are surfaced per-pad/via
  `/status` rather than failing the whole request. The core single-rack,
  all-Simpler-pads case is now confirmed working end-to-end (see above);
  these two edge cases specifically remain unexercised against a real
  multi-rack or Drum-Sampler-based track.
- **16 separate undo steps per Send to Rack**, same as the original plan
  flagged — each `replace_sample` call is its own undoable action in Live,
  not batched into one.
- **This machine's actual `library.db` is still corrupted.** v1.2.0 shipped
  the in-app "Reset library database" recovery action (Settings tab), and a
  known-good backup of the corrupted file sits in this session's scratchpad,
  but the reset was never actually run against the live file — the app had
  13 `DDW Drum Rack Generator` processes open at the time, and Windows keeps
  the file locked while any of them hold it. Needs: close every open DDW
  window, then either click Settings → Reset library database, or run the
  file-delete manually.
- ~~**M4L device "Open DDW"/loading issue reported after v1.1.0.**~~
  **Resolved in v1.2.1** — this was never a device bug. Root cause: the
  installer was stale (see v1.2.1 above), so "Open DDW" was correctly
  launching an old build with none of the newer UI. `.amxd`/
  `ddw-bridge.js`/`ddw-live.js` were confirmed byte-identical to the repo the
  whole time.
