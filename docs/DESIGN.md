# Design System — DDW Drum Rack Generator

Source of truth for the device UI. Extracted from the user-approved mockup
`DDW Drum Rack Generator — Ableton Device UI (Redesigned Types Dropdown).html`
(kept on the user's Desktop, not in this repo). The device UI was **rebuilt
from this spec**, not copy-pasted from that file — see
[`../src/tokens.css`](../src/tokens.css) and [`../src/device.css`](../src/device.css).

Only the `.ableton-device-frame` panel from the mockup is the product. The
mockup's outer page (dark gallery wrapper, header badge, three showcase
cards, redundant top tab-nav-bar) was presentation scaffolding for showing
the design off and is not part of the app — the device's own 4-button rail
is the only navigation.

## Surface ladder

Each nested container is one step lighter than its parent. This is what
makes flat CSS boxes read as physical device chrome rather than a stack of
identical panels.

```
#141414 rail  →  #181818 viewport  →  #1a1a1a layout
→  #202020 panel  →  #262626 pad  →  #2d2d2d titlebar
```

Tokens: `--surface-rail`, `--surface-viewport`, `--surface-layout`,
`--surface-panel`, `--surface-pad`, `--surface-titlebar`.

## Single accent

`--accent` (`#e5a93c`, amber) is the *only* interactive color in the device.
It appears exclusively on: the power LED, the active rail tab, the Reroll
button, a locked pad's border/glow, the type-dropdown text, and the stepper
buttons. The rule: amber means active, yours, or clickable — nothing
passive or informational ever uses it.

## Category hues

Category tags label sample *content*, never UI *state*, so they use a
separate, fixed palette that never overlaps with the accent:

| Category | Token | Hex |
|---|---|---|
| kick | `--cat-kick` | `#f59e0b` |
| snare | `--cat-snare` | `#f43f5e` |
| hat | `--cat-hat` | `#38bdf8` |
| perc | `--cat-perc` | `#c084fc` |
| 808 | `--cat-808` | `#eab308` |

Formula for each: 20%-alpha fill background (`color-mix(in srgb, var(--cat-x) 20%, transparent)`) + full-strength text color.

## Typography

Two families, used semantically rather than decoratively:

- **Mono** (`ui-monospace, JetBrains Mono, ...`) — anything countable or
  technical: sample counts, note names, rail labels, the tab indicator,
  the type dropdown.
- **Sans** (system font stack) — human-authored labels: filter row text,
  pad filenames, status messages.

## Layout

4-column CSS grid: rail / context panel / mid panel / pad grid.

```
grid-template-columns: 52px 260px 160px 1fr;
```

(The mockup's columns were `36px 195px 115px 1fr`, sized for a literal
`420×169px` Max for Live `jsui` surface. This app runs as a normal desktop
window, not embedded in a `420×169` device strip, so the columns were
scaled up for legibility while preserving the same proportions and the
same 4-region structure.)

- **Rail** — 4 buttons: Packs 📁 / Types 🏷️ / Rules ⚙️ / Info ℹ️. Active tab
  gets the amber left-border treatment.
- **Context panel** — swaps content entirely per rail tab.
- **Mid panel** — Reroll All button, pack/sample stats, audition toggle,
  status line. Present regardless of which rail tab is active.
- **Pad grid** — 4×4, always visible regardless of rail tab.

## Type sub-configurations

Each Type (chosen via the dropdown in the Types tab) owns its own
subcategory filter list *and* its own cut-off semantics — they are not a
shared list with a shared unit.

| Type | Subcategories | Cut-off | Step |
|---|---|---|---|
| One-Shots | Kicks & 808s, Snares & Rims, Claps & Snaps, Hi-Hats, Toms, Perc & Shakers, Cymbals | Max Duration, ms | 50 ms |
| Loops | Full Drum Loops, Top Loops, Percussion Loops, Bass & 808 Loops, Fills & Rolls, Breaks | Max Loop, bars | 1 bar |
| Other | FX/Sweeps/Risers, Atmospheres, Tonal Chords/Stabs, Vocal Chops, Wet Tails, Unclassified | Max Tail, ms | 100 ms |

The Loops stepper displays a parenthetical duration hint, e.g. `4 Bars
(8s)`, computed from a **placeholder 120 BPM / 4-4 reference** — real
tempo-aware conversion (from a user-set project tempo or filename-embedded
BPM) is deferred; see the open items in `IMPLEMENTATION_PLAN.md`.

## Deviation from the mockup — pad note order

The mockup's pad grid had an inconsistency: the bottom row displayed notes
in ascending order (36→39) but the three rows above it displayed
**descending** order (e.g. top row was 51→48). A real Ableton Drum Rack's
Pad View places note 36 (C1) bottom-left and ascends left-to-right,
bottom-to-top (confirmed against the Live 12 manual's Pad View section).
Replicating the mockup's bug verbatim would scramble every generated kit's
layout, so this app corrects it:

```
row 1 (top):     48  49  50  51     C2  C#2 D2  D#2
row 2:           44  45  46  47     G#1 A1  A#1 B1
row 3:           40  41  42  43     E1  F1  F#1 G1
row 4 (bottom):  36  37  38  39     C1  C#1 D1  D#1
```

Each row ascends left-to-right; note number increases going up the grid —
matching Live's real Pad View. The note→category pairing itself (e.g. note
36 = Kick, note 39 = Snare) is unchanged from the mockup; only which grid
*position* each note renders in was corrected.
