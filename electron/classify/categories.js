// Default category rules for the categorization engine (v0.3.0). Array
// order doubles as the tie-break priority when two aliases from different
// categories match a filename with the same length (see matcher.js) — e.g.
// kick beats perc on an equal-length coincidental match. Users can edit
// aliases and max length per category from the Rules tab; this array is
// only the factory default used to seed a fresh library and to restore a
// category via "Reset to default".
const DEFAULT_CATEGORIES = [
  { id: 'kick',  label: 'Kick',         aliases: ['kick', 'kik', 'bassdrum', 'bd'],           maxLenMs: 800 },
  { id: 'snare', label: 'Snare',        aliases: ['snare', 'snr'],                            maxLenMs: 700 },
  { id: 'clap',  label: 'Clap / Snap',  aliases: ['clap', 'snap', 'finger'],                  maxLenMs: 600 },
  { id: 'rim',   label: 'Rim / Side',   aliases: ['rim', 'sidestick', 'rimshot'],             maxLenMs: 400 },
  { id: 'tom',   label: 'Tom',          aliases: ['tom'],                                     maxLenMs: 900 },
  { id: 'hat',   label: 'Hat',          aliases: ['hat', 'hh', 'chat', 'ohat', 'hihat'],      maxLenMs: 400 },
  { id: 'crash', label: 'Crash / Ride', aliases: ['crash', 'ride', 'cymbal'],                 maxLenMs: 3000 },
  { id: 'perc',  label: 'Perc',         aliases: ['perc', 'shaker', 'bongo', 'conga', 'tamb'], maxLenMs: 800 }
];

module.exports = { DEFAULT_CATEGORIES };
