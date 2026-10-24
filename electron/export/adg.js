// v0.6.0 .adg export: clones the 16 DrumBranchPreset device chains from the
// local skeleton (see buildSkeleton.js) and patches in each pad's sample.
//
// Sample references use RelativePathType=1/Type=1 with an empty RelativePath
// and a real absolute Path — the pattern verified against a real, working
// Live 12.4.3 project's own external (non-Library, non-Pack) sample
// reference. Whether RelativePathType=1's relative-path resolution behaves
// identically in a standalone .adg preset (no project folder) as in an .als
// project is unconfirmed — since Path is the field verified load-critical in
// every real example, RelativePath is left empty rather than guessing at a
// resolution base that might be wrong, and Path always carries the real,
// correct absolute location. This is the one part of the export that can
// only be confirmed by actually dragging a generated file into Live.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SKELETON_PATH = path.join(__dirname, 'skeleton.adg');
const PAD_COUNT = 16;

let cachedBranches = null;

function skeletonAvailable() {
  return fs.existsSync(SKELETON_PATH);
}

function loadBranches() {
  if (cachedBranches) return cachedBranches;
  if (!skeletonAvailable()) {
    throw new Error('Export skeleton missing — run "npm run build:skeleton" once (see README) before exporting.');
  }
  const xml = zlib.gunzipSync(fs.readFileSync(SKELETON_PATH)).toString('utf8');

  const branchOpenRe = /<DrumBranchPreset Id="\d+">/g;
  const starts = [];
  let m;
  while ((m = branchOpenRe.exec(xml))) starts.push(m.index);
  if (starts.length !== PAD_COUNT) {
    throw new Error(`Skeleton is malformed: expected ${PAD_COUNT} DrumBranchPreset blocks, found ${starts.length}.`);
  }

  const branchesCloseIdx = xml.indexOf('</BranchPresets>', starts[PAD_COUNT - 1]);
  if (branchesCloseIdx === -1) {
    throw new Error('Skeleton is malformed: no </BranchPresets> found after the last branch.');
  }

  const head = xml.slice(0, starts[0]);
  const branches = [];
  for (let i = 0; i < PAD_COUNT; i++) {
    const end = i < PAD_COUNT - 1 ? starts[i + 1] : branchesCloseIdx;
    branches.push(xml.slice(starts[i], end));
  }
  const tail = xml.slice(branchesCloseIdx);

  cachedBranches = { head, branches, tail };
  return cachedBranches;
}

function escapeXmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toForwardSlashPath(winPath) {
  return winPath.replace(/\\/g, '/');
}

function replaceFirst(xml, regex, replacement) {
  let hit = false;
  const out = xml.replace(regex, (...args) => {
    hit = true;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (!hit) throw new Error(`Export template patch failed: pattern not found (${regex}).`);
  return out;
}

function buildFileRefXml(openTag, { absPath, fileSize }) {
  return `${openTag}\n\t\t\t\t\t\t\t\t\t<RelativePathType Value="1" />\n\t\t\t\t\t\t\t\t\t<RelativePath Value="" />\n\t\t\t\t\t\t\t\t\t<Path Value="${escapeXmlAttr(absPath)}" />\n\t\t\t\t\t\t\t\t\t<Type Value="1" />\n\t\t\t\t\t\t\t\t\t<LivePackName Value="" />\n\t\t\t\t\t\t\t\t\t<LivePackId Value="" />\n\t\t\t\t\t\t\t\t\t<OriginalFileSize Value="${fileSize}" />\n\t\t\t\t\t\t\t\t\t<OriginalCrc Value="0" />\n\t\t\t\t\t\t\t\t</FileRef>`;
}

// pad: { note, samplePath, sampleName, durationMs, sampleRate, fileSize, mtimeSec }
function patchBranch(branchXml, pad) {
  const openIdx = branchXml.indexOf('<MultiSamplePart ');
  const closeTag = '</MultiSamplePart>';
  const closeIdx = branchXml.indexOf(closeTag, openIdx);
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error('Export template patch failed: <MultiSamplePart> not found in branch.');
  }
  const before = branchXml.slice(0, openIdx);
  let scoped = branchXml.slice(openIdx, closeIdx + closeTag.length);
  const after = branchXml.slice(closeIdx + closeTag.length);

  const frames = Math.max(0, Math.round((pad.durationMs / 1000) * pad.sampleRate));
  const absPath = toForwardSlashPath(pad.samplePath);

  scoped = replaceFirst(scoped, /<Name Value="[^"]*" \/>/, `<Name Value="${escapeXmlAttr(pad.sampleName)}" />`);
  scoped = replaceFirst(scoped, /<SampleEnd Value="[^"]*" \/>/, `<SampleEnd Value="${frames}" />`);
  scoped = scoped.replace(/<End Value="[^"]*" \/>/g, `<End Value="${frames}" />`);
  scoped = scoped.replace(/(<FileRef[^>]*>)[\s\S]*?<\/FileRef>/g, (_match, openTag) =>
    buildFileRefXml(openTag, { absPath, fileSize: pad.fileSize })
  );
  scoped = replaceFirst(scoped, /<LastModDate Value="[^"]*" \/>/, `<LastModDate Value="${pad.mtimeSec}" />`);
  scoped = replaceFirst(scoped, /<DefaultDuration Value="[^"]*" \/>/, `<DefaultDuration Value="${frames + 1}" />`);
  scoped = replaceFirst(scoped, /<DefaultSampleRate Value="[^"]*" \/>/, `<DefaultSampleRate Value="${pad.sampleRate}" />`);

  let branch = before + scoped + after;
  branch = replaceFirst(branch, /<Name Value="[^"]*" \/>/, `<Name Value="${escapeXmlAttr(pad.sampleName)}" />`);
  branch = replaceFirst(branch, /<ReceivingNote Value="[^"]*" \/>/, `<ReceivingNote Value="${pad.note}" />`);
  return branch;
}

// v1.1.1: an unfilled pad (pad.samplePath === null) skips sample patching
// entirely — the skeleton's own pristine branch state (see buildSkeleton.js)
// already *is* an unassigned Simpler (empty FileRef, Type="2"), so leaving
// MultiSamplePart/FileRef untouched is exactly "no sample loaded", the same
// as a real empty Drum Rack pad. Only the receiving note (so the branch still
// lands on the right pad button) and both Name fields (so no leftover
// donor-pack sample name like "Kick Bass Drum" shows through) get patched.
function patchEmptyBranch(branchXml, note) {
  const openIdx = branchXml.indexOf('<MultiSamplePart ');
  const closeTag = '</MultiSamplePart>';
  const closeIdx = branchXml.indexOf(closeTag, openIdx);
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error('Export template patch failed: <MultiSamplePart> not found in branch.');
  }
  const before = branchXml.slice(0, openIdx);
  let scoped = branchXml.slice(openIdx, closeIdx + closeTag.length);
  const after = branchXml.slice(closeIdx + closeTag.length);

  scoped = replaceFirst(scoped, /<Name Value="[^"]*" \/>/, '<Name Value="" />');

  let branch = before + scoped + after;
  branch = replaceFirst(branch, /<Name Value="[^"]*" \/>/, '<Name Value="" />');
  branch = replaceFirst(branch, /<ReceivingNote Value="[^"]*" \/>/, `<ReceivingNote Value="${note}" />`);
  return branch;
}

// pads: array of exactly 16 pad objects, in branch-index order (pads[i] fills
// the template's branch i). As of v1.1.1, a pad may have samplePath: null
// (unfilled) — its branch is left as an empty/unassigned pad rather than
// carrying a sample, see patchEmptyBranch above. main.js's export:adg
// handler only requires at least one pad to be filled, not all 16.
function buildAdgBuffer(pads) {
  if (!Array.isArray(pads) || pads.length !== PAD_COUNT) {
    throw new Error(`buildAdgBuffer requires exactly ${PAD_COUNT} pads, got ${pads && pads.length}.`);
  }
  const { head, branches, tail } = loadBranches();
  const patchedBranches = branches.map((branchXml, i) =>
    pads[i].samplePath ? patchBranch(branchXml, pads[i]) : patchEmptyBranch(branchXml, pads[i].note)
  );
  const xml = head + patchedBranches.join('') + tail;
  return zlib.gzipSync(Buffer.from(xml, 'utf8'));
}

module.exports = { buildAdgBuffer, skeletonAvailable, PAD_COUNT };
