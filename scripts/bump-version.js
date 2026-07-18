const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const STATE_PATH = path.join(ROOT, '.jarvis-build.json');

const SCAN_DIRS = [
  path.join(ROOT, 'backend', 'src'),
  path.join(ROOT, 'frontend', 'src'),
  path.join(ROOT, 'desktop'),
  path.join(ROOT, 'scripts'),
];

const SCAN_ROOT_FILES = [
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'electron-builder.json'),
];

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'coverage', 'release']);

function walkDir(dir, files) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env') {
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      walkDir(path.join(dir, entry.name), files);
      continue;
    }
    if (entry.isFile()) {
      files.push(path.join(dir, entry.name));
    }
  }
}

function collectSourceFiles() {
  const files = [...SCAN_ROOT_FILES.filter((f) => fs.existsSync(f))];
  for (const dir of SCAN_DIRS) {
    walkDir(dir, files);
  }
  return files.sort();
}

function fingerprintSources() {
  const hash = crypto.createHash('sha256');
  for (const file of collectSourceFiles()) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function readPkgVersion() {
  return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version ?? '1.0.0';
}

function writePkgVersion(version) {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function bumpPatch(version) {
  const parts = String(version).split('.').map((p) => Number.parseInt(p, 10));
  const major = Number.isFinite(parts[0]) ? parts[0] : 1;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const patch = Number.isFinite(parts[2]) ? parts[2] : 0;
  return `${major}.${minor}.${patch + 1}`;
}

function main() {
  const fingerprint = fingerprintSources();
  const state = readState();
  let version = readPkgVersion();
  let bumped = false;

  if (!state) {
    writeState({ version, fingerprint, builtAt: new Date().toISOString() });
    console.log(`[jarvis] Build fingerprint initialized — version ${version}`);
    return;
  }

  if (state.fingerprint !== fingerprint) {
    version = bumpPatch(state.version ?? version);
    writePkgVersion(version);
    writeState({ version, fingerprint, builtAt: new Date().toISOString() });
    bumped = true;
    console.log(`[jarvis] Source changed — version bumped to ${version}`);
    console.log(`[jarvis] Exe output: JARVIS-${version}-portable.exe / JARVIS-${version}-setup.exe`);
    return;
  }

  writeState({ ...state, version, builtAt: new Date().toISOString() });
  console.log(`[jarvis] No source changes — keeping version ${version}`);
}

main();
