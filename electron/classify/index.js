const db = require('../db');
const { categorizeSample } = require('./matcher');
const { classifyTypes } = require('./types');

// Recomputes category_id for samples using the current (possibly
// user-edited) rules from the Rules tab. Called with onlyUncategorized=true
// after a scan (only new samples need it — an existing sample's filename
// can't change without its path changing, which makes it a new row), and
// with false whenever the rules themselves change, since every sample's
// classification could shift.
function categorizeSamples(onlyUncategorized) {
  const categories = db.listCategoryRules();
  const samples = db.getSamplesForCategorization({ onlyUncategorized });
  const updates = samples.map(s => ({ id: s.id, categoryId: categorizeSample(s.path, categories) }));
  db.setSampleCategories(updates);
  return updates.length;
}

module.exports = { categorizeSamples, classifyTypes };
