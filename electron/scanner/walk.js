const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXTS = new Set(['.wav', '.wave', '.aif', '.aiff', '.aifc']);

// Recursively walks a directory, yielding one entry per audio file found.
// Async generator over fs.promises.opendir per file, so each step is a
// non-blocking I/O op — the main process event loop (and therefore IPC/the
// window) stays responsive across a 20,000+ file walk without needing a
// worker thread, since the work here is I/O-bound, not CPU-bound.
async function* walkAudioFiles(rootDir) {
  yield* walkDir(rootDir);
}

async function* walkDir(dir) {
  let dirHandle;
  try {
    dirHandle = await fs.promises.opendir(dir);
  } catch {
    return; // permission denied / removed mid-scan — skip this branch, don't abort the whole scan
  }

  for await (const dirent of dirHandle) {
    if (dirent.name.startsWith('.')) continue; // skip hidden files/dirs (.DS_Store, .git, etc.)
    if (dirent.isSymbolicLink()) continue; // avoid symlink cycles

    const fullPath = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      yield* walkDir(fullPath);
      continue;
    }
    if (!dirent.isFile()) continue;

    const ext = path.extname(dirent.name);
    if (!AUDIO_EXTS.has(ext.toLowerCase())) continue;

    let stat;
    try {
      stat = await fs.promises.stat(fullPath);
    } catch {
      continue; // race: file removed between readdir and stat
    }

    yield {
      path: fullPath,
      name: dirent.name,
      ext,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs)
    };
  }
}

module.exports = { walkAudioFiles, AUDIO_EXTS };
