const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, '..', 'backend', 'node_modules');

const DROP_DIR_NAMES = new Set([
  'test',
  'tests',
  '__tests__',
  'docs',
  'doc',
  'example',
  'examples',
  'coverage',
  '.github',
  'benchmark',
  'benchmarks',
]);

const DROP_FILE_RE = /\.(md|markdown|map|tsbuildinfo)$/i;
const DROP_FILE_NAMES = new Set(['LICENSE', 'LICENSE.md', 'CHANGELOG', 'CHANGELOG.md', 'README', 'README.md']);

function shouldDropDir(name) {
  return DROP_DIR_NAMES.has(name.toLowerCase());
}

function shouldDropFile(name) {
  if (DROP_FILE_NAMES.has(name)) {
    return true;
  }
  return DROP_FILE_RE.test(name);
}

function slimDir(dir, stats) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldDropDir(entry.name)) {
        fs.rmSync(full, { recursive: true, force: true });
        stats.dirs += 1;
        continue;
      }
      slimDir(full, stats);
      continue;
    }

    if (shouldDropFile(entry.name)) {
      try {
        fs.unlinkSync(full);
        stats.files += 1;
      } catch {
        /* locked */
      }
    }
  }
}

if (!fs.existsSync(NM)) {
  process.exit(0);
}

const stats = { dirs: 0, files: 0 };
slimDir(NM, stats);
console.log(`[jarvis] Desktop pack: trimmed node_modules junk (${stats.dirs} dirs, ${stats.files} files removed).`);
