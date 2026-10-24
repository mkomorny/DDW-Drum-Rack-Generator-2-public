// Type + subcategory taxonomy for the Types tab (v0.4.0). Every sample's
// type_id ('oneshot' | 'loop' | 'other') and subcategory_id are computed in
// electron/classify/types.js from its v0.3.0 category_id/duration plus
// filename hints — see that file for the decision order.

// One-Shot subcategories map directly onto the v0.3.0 category taxonomy;
// snare and rim collapse into one bucket to match the 7 subcategories from
// the approved mockup (docs/DESIGN.md TYPE_CONFIGS) against the 8 v0.3.0
// categories.
const ONE_SHOT_SUBCATEGORIES = [
  { id: 'kicks',   label: 'Kicks & 808s' },
  { id: 'snares',  label: 'Snares & Rims' },
  { id: 'claps',   label: 'Claps & Snaps' },
  { id: 'hats',    label: 'Hi-Hats (Clsd/Open)' },
  { id: 'toms',    label: 'Toms (Hi/Mid/Low)' },
  { id: 'perc',    label: 'Perc & Shakers' },
  { id: 'cymbals', label: 'Cymbals (Crash/Ride)' }
];

const ONE_SHOT_SUBCATEGORY_MAP = {
  kick: 'kicks', snare: 'snares', rim: 'snares', clap: 'claps',
  hat: 'hats', tom: 'toms', perc: 'perc', crash: 'cymbals'
};

// Loop subcategories double as the "is this even a loop" trigger: if any
// alias anywhere in this table matches a sample's filename/parent folder,
// it's classified as a Loop (checked before the One-Shot/Other rules run),
// using the same longest-alias-wins substring matcher as v0.3.0 category
// matching (electron/classify/matcher.js).
const LOOP_SUBCATEGORIES = [
  { id: 'breaks', label: 'Breaks & Vintage Chops', aliases: ['break', 'brk', 'chop', 'vintage'] },
  { id: 'fills',  label: 'Drum Fills & Rolls',      aliases: ['fill', 'roll'] },
  { id: 'bass',   label: 'Bass & 808 Loops',        aliases: ['bassloop', '808loop', 'bass', '808'] },
  { id: 'perc',   label: 'Percussion Loops',        aliases: ['percloop', 'percussion'] },
  { id: 'top',    label: 'Top Loops (No Kick)',     aliases: ['toploop', 'topgroove', 'top'] },
  { id: 'full',   label: 'Full Drum Loops',         aliases: ['fullloop', 'drumloop', 'loop', 'groove', 'full'] }
];

// Other subcategories, also alias-matched. 'unclassified' has no aliases —
// it never matches directly and is the fallback used when nothing else,
// including a One-Shot category match, applies (see types.js).
const OTHER_SUBCATEGORIES = [
  { id: 'fx',     label: 'FX, Sweeps & Risers',    aliases: ['riser', 'sweep', 'impact', 'whoosh', 'fx'] },
  { id: 'atmos',  label: 'Atmospheres & Vinyl',     aliases: ['atmos', 'ambience', 'ambient', 'vinyl', 'noise'] },
  { id: 'tonal',  label: 'Tonal Chords & Stabs',    aliases: ['chord', 'stab', 'tonal', 'pad'] },
  { id: 'vocal',  label: 'Vocal Chops & Glitches',  aliases: ['vocal', 'vox', 'glitch'] },
  { id: 'tail',   label: 'Wet / Processed Tails',   aliases: ['tail', 'reverb', 'verb', 'wet'] },
  { id: 'unclassified', label: 'Unclassified Filenames', aliases: [] }
];

// Types tab metadata + default cut-offs (persisted in db's type_cutoffs
// table, editable via the stepper). Loops' cut-off is in bars, not ms —
// converted using the same 120 BPM / 4-4 (2s per bar) placeholder as the
// v0.1.0 mock display, pending a real tempo source (see
// docs/IMPLEMENTATION_PLAN.md open items).
const TYPE_DEFS = [
  { id: 'oneshot', label: 'One-Shots', stepperLabel: 'Max Duration:', stepUnit: ' ms',   stepDelta: 50,  stepMin: 50,  defaultCutoff: 1200, subcategories: ONE_SHOT_SUBCATEGORIES },
  { id: 'loop',    label: 'Loops',     stepperLabel: 'Max Loop:',     stepUnit: ' Bars', stepDelta: 1,   stepMin: 1,   defaultCutoff: 4,    subcategories: LOOP_SUBCATEGORIES },
  { id: 'other',   label: 'Other',     stepperLabel: 'Max Tail:',     stepUnit: ' ms',   stepDelta: 100, stepMin: 100, defaultCutoff: 2500, subcategories: OTHER_SUBCATEGORIES }
];

const MS_PER_BAR_AT_120BPM = 2000;

module.exports = {
  TYPE_DEFS, ONE_SHOT_SUBCATEGORIES, ONE_SHOT_SUBCATEGORY_MAP,
  LOOP_SUBCATEGORIES, OTHER_SUBCATEGORIES, MS_PER_BAR_AT_120BPM
};
