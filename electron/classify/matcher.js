// Filename + parent-folder categorization (v0.3.0). Matches each category's
// aliases as case-insensitive substrings against the sample's filename
// (extension stripped) and its immediate parent folder name — so a pack
// organized into "Kicks/01.wav"-style subfolders classifies correctly even
// when the files themselves are named generically.
//
// Conflict resolution: longest-alias-wins (e.g. "rimshot" beats "rim" when
// both are substrings of the same filename, since it's the more specific
// match), then the category's position in the rules array breaks any
// remaining tie between equal-length aliases from different categories.

function baseName(filePath) {
  const parts = String(filePath).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function parentFolderName(filePath) {
  const parts = String(filePath).split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

function stripExt(filename) {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

// categories: array of {id, aliases}, in priority order (earlier wins ties).
function categorizeSample(filePath, categories) {
  const haystack = `${stripExt(baseName(filePath))} ${parentFolderName(filePath)}`.toLowerCase();

  let best = null; // { categoryId, aliasLen, priorityIdx }
  categories.forEach((cat, priorityIdx) => {
    for (const alias of cat.aliases) {
      const needle = alias.toLowerCase().trim();
      if (!needle || !haystack.includes(needle)) continue;
      if (!best || needle.length > best.aliasLen ||
          (needle.length === best.aliasLen && priorityIdx < best.priorityIdx)) {
        best = { categoryId: cat.id, aliasLen: needle.length, priorityIdx };
      }
    }
  });

  return best ? best.categoryId : null;
}

module.exports = { categorizeSample, baseName, parentFolderName, stripExt };
