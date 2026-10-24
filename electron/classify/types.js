const db = require('../db');
const { categorizeSample } = require('./matcher');
const { LOOP_SUBCATEGORIES, OTHER_SUBCATEGORIES, ONE_SHOT_SUBCATEGORY_MAP } = require('./typeCategories');

// Decision order, run per sample:
//   1. Loop — any LOOP_SUBCATEGORIES alias matches the filename/parent
//      folder (same substring matcher as v0.3.0 category matching).
//   2. One-Shot — the sample already has a v0.3.0 category_id AND its
//      duration is within that category's Rules-tab max length (or the
//      duration is unknown, e.g. an unreadable header — an alias match is
//      trusted over a missing duration rather than punting to Other). This
//      is where max_len_ms, persisted since v0.3.0 but unused until now,
//      finally gets consumed.
//   3. Other — OTHER_SUBCATEGORIES alias match, or 'unclassified' if none.
function classifySample(sample, categoryRules) {
  const loopMatch = categorizeSample(sample.path, LOOP_SUBCATEGORIES);
  if (loopMatch) return { typeId: 'loop', subcategoryId: loopMatch };

  if (sample.categoryId) {
    const rule = categoryRules.find(r => r.id === sample.categoryId);
    const withinCutoff = sample.durationMs == null || !rule || sample.durationMs <= rule.maxLenMs;
    if (withinCutoff) {
      return { typeId: 'oneshot', subcategoryId: ONE_SHOT_SUBCATEGORY_MAP[sample.categoryId] };
    }
  }

  const otherMatch = categorizeSample(sample.path, OTHER_SUBCATEGORIES);
  return { typeId: 'other', subcategoryId: otherMatch || 'unclassified' };
}

// Recomputes type_id/subcategory_id, mirroring
// electron/classify/index.js's categorizeSamples: onlyUnclassified=true
// after a scan (only new samples need it), false whenever something that
// feeds the decision above changes — a category's aliases (main.js already
// reruns categorizeSamples first in that case) or its max length (which
// alone doesn't move a sample between v0.3.0 categories, but does move it
// between One-Shot and Other here).
function classifyTypes(onlyUnclassified) {
  const categoryRules = db.listCategoryRules();
  const samples = db.getSamplesForTypeClassification({ onlyUnclassified });
  const updates = samples.map(s => ({ id: s.id, ...classifySample(s, categoryRules) }));
  db.setSampleTypes(updates);
  return updates.length;
}

module.exports = { classifyTypes, classifySample };
