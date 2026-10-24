// One-time local setup step for v0.6.0 export: derives `skeleton.adg` (a
// content-neutral Live-12 DrumGroupDevice XML structure — 16 DrumBranchPreset
// device chains, each an OriginalSimpler with an empty sample slot) from a
// real Ableton Live Pack Drum Rack preset already on this machine.
//
// Why this exists instead of hand-authoring the XML: a single DrumBranchPreset
// is ~1200 lines (Simpler's full parameter set, mixer, macro mappings) and
// nothing about that structure is documented — it was reverse-engineered this
// session from real files. Hand-typing it untested risked producing a file
// Live would reject. Cloning a real factory-pack preset and stripping every
// piece of that pack's actual identity — pack name/id, sample names, sample
// file paths, the creator's desktop username, and the macro knobs' tweaked
// sound-design positions — leaves only Ableton's own mechanical device
// defaults (parameter min/max ranges, on/off states, generic device chain
// shape) behind. That result is committed to git as `buildSkeleton.js` (this
// file, pure transform code); the *output* (`skeleton.adg`) is not committed
// — it's derived fresh from the user's own legitimately-owned Live Pack via
// `npm run build:skeleton`, same pattern as the DB/settings files this repo
// already gitignores.
//
// Run: node electron/export/buildSkeleton.js [pathToSourceAdg]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_SOURCE = 'A:\\Samples_Packs\\Ableton Live Packs\\Drum Essentials\\Drums\\Drum Machines\\505 Classic Kit.adg';
const OUTPUT_PATH = path.join(__dirname, 'skeleton.adg');

function blankTemplate(xml) {
  xml = xml.replace(/UserName Value="505 Classic Kit"/g, 'UserName Value="DDW Drum Rack"');
  xml = xml.replace(/UpperDisplayString Value="1-505 Classic Kit"/g, 'UpperDisplayString Value="1-Pad"');
  xml = xml.replace(/LowerDisplayString Value="505 Classic Kit \| a Audio Effects \| Chain In"/g, 'LowerDisplayString Value="Pad | a Audio Effects | Chain In"');

  // Rack's own self-referencing "last saved from" pointer — appears more
  // than once (top-level LastPresetRef plus at least one branch-level copy).
  xml = xml.replace(/<RelativePath Value="(?:\.\.\/)+505 Classic Kit-1-1\.adg" \/>/g, '<RelativePath Value="" />');
  xml = xml.replace(/<Path Value="(?:\/\.\.)+\/505 Classic Kit-1-1\.adg" \/>/g, '<Path Value="" />');
  xml = xml.replace(
    /<RelativePathType Value="1" \/>(\s*<RelativePath Value="" \/>\s*<Path Value="" \/>\s*<Type Value="2" \/>\s*<LivePackName Value="" \/>\s*<LivePackId Value="" \/>\s*<OriginalFileSize Value="0" \/>\s*<OriginalCrc Value="0" \/>\s*<\/FileRef>\s*<\/FilePresetRef>)/g,
    '<RelativePathType Value="0" />$1'
  );

  // Per-sample display name: strip the pack-specific " 505 Classic" suffix.
  xml = xml.replace(/(<Name Value="[^"]*?) 505 Classic(")/g, '$1$2');

  // Real (non-placeholder) FileRef fields -> the template's own "unassigned" convention.
  xml = xml.replace(/RelativePathType Value="5"/g, 'RelativePathType Value="0"');
  xml = xml.replace(/<RelativePath Value="Samples\/Drums\/[^"]*" \/>/g, '<RelativePath Value="" />');
  xml = xml.replace(/<Path Value="\/Volumes\/data\/tmp\/trunk\/Drum Essentials\/[^"]*" \/>/g, '<Path Value="" />');
  xml = xml.replace(/LivePackName Value="Drum Essentials"/g, 'LivePackName Value=""');
  xml = xml.replace(/LivePackId Value="www\.ableton\.com\/249"/g, 'LivePackId Value=""');
  xml = xml.replace(/OriginalFileSize Value="\d+"/g, 'OriginalFileSize Value="0"');
  xml = xml.replace(/OriginalCrc Value="\d+"/g, 'OriginalCrc Value="0"');
  xml = xml.replace(/LastModDate Value="\d+"/g, 'LastModDate Value="0"');

  // Browser hint paths carried the original creator's desktop username.
  xml = xml.replace(/<BrowserContentPath Value="query:UserLibrary#Samples:Imported:[^"]*" \/>/g, '<BrowserContentPath Value="" />');
  xml = xml.replace(/<BrowserContentPath Value="userfolder:\/Users\/[^"]*" \/>/g, '<BrowserContentPath Value="" />');

  // Sample timing placeholders (always overwritten per-pad at export time anyway).
  xml = xml.replace(/<SampleEnd Value="\d+"/g, '<SampleEnd Value="0"');
  xml = xml.replace(/<End Value="\d+"(\s*\/>\s*<Mode Value="[03]")/g, '<End Value="0"$1');
  xml = xml.replace(/<DefaultDuration Value="\d+"/g, '<DefaultDuration Value="0"');
  xml = xml.replace(/<DefaultSampleRate Value="\d+"/g, '<DefaultSampleRate Value="44100"');

  // Macro knob positions are the pack's own sound-design tuning, not a
  // structural default — zero every macro back to its unmapped rest state.
  xml = xml.replace(/(<MacroControls\.\d+>\s*<LomId Value="0" \/>\s*<Manual Value=")[^"]*(")/g, '$10$2');

  // Return-chain stock effects (Auto Filter, Compressor, etc.) carry
  // LastPresetRef lineage FileRefs pointing at the *original pack author's*
  // local machine path (e.g. /Users/<name>/...) — navigational metadata
  // only, not load-critical, but a real personal path with no reason to
  // carry it forward. Blank any FileRef block that leaks one.
  xml = xml.replace(/<FileRef([^>]*)>[\s\S]*?<\/FileRef>/g, (block, attrs) => {
    if (!/\/Users\/|\/Volumes\//.test(block)) return block;
    return `<FileRef${attrs}>\n\t\t\t\t\t\t\t\t\t<RelativePathType Value="0" />\n\t\t\t\t\t\t\t\t\t<RelativePath Value="" />\n\t\t\t\t\t\t\t\t\t<Path Value="" />\n\t\t\t\t\t\t\t\t\t<Type Value="2" />\n\t\t\t\t\t\t\t\t\t<LivePackName Value="" />\n\t\t\t\t\t\t\t\t\t<LivePackId Value="" />\n\t\t\t\t\t\t\t\t\t<OriginalFileSize Value="0" />\n\t\t\t\t\t\t\t\t\t<OriginalCrc Value="0" />\n\t\t\t\t\t\t\t\t</FileRef>`;
  });

  return xml;
}

function main() {
  const sourcePath = process.argv[2] || DEFAULT_SOURCE;
  if (!fs.existsSync(sourcePath)) {
    console.error(`Source .adg not found: ${sourcePath}`);
    console.error('Pass a path to a Live 12 Drum Rack .adg from an Ableton Live Pack, e.g.:');
    console.error('  node electron/export/buildSkeleton.js "A:\\Samples_Packs\\Ableton Live Packs\\<pack>\\<file>.adg"');
    process.exit(1);
  }

  const raw = fs.readFileSync(sourcePath);
  const xml = zlib.gunzipSync(raw).toString('utf8');

  if (!xml.includes('<DrumGroupDevice') || !/<DrumBranchPreset Id="15"/.test(xml)) {
    console.error('Source file does not look like a plain-root, 16-pad Drum Rack preset (no <DrumGroupDevice>/16 DrumBranchPreset blocks found).');
    process.exit(1);
  }

  const blanked = blankTemplate(xml);

  const leftovers = ['Drum Essentials', 'www.ableton.com', '/Volumes/', '/Users/', 'Classic Kit', '505', 'pma', 'rbr'];
  for (const needle of leftovers) {
    if (blanked.includes(needle)) {
      console.error(`Refusing to write skeleton.adg: leftover identifying content "${needle}" still present after blanking.`);
      process.exit(1);
    }
  }

  const gz = zlib.gzipSync(Buffer.from(blanked, 'utf8'));
  fs.writeFileSync(OUTPUT_PATH, gz);
  console.log(`Wrote ${OUTPUT_PATH} (${gz.length} bytes gzipped, ${blanked.length} bytes XML)`);
}

if (require.main === module) {
  main();
}

module.exports = { blankTemplate };
