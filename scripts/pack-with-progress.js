const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);

function readReleaseDir(argv) {
  for (const arg of argv) {
    const match = arg.match(/directories\.output=(.+)$/);
    if (match?.[1]) {
      return path.join(ROOT, match[1]);
    }
  }
  return path.join(ROOT, 'release');
}

const RELEASE = readReleaseDir(args);
const UNPACKED = path.join(RELEASE, 'win-unpacked');

const packArgs = args.length ? args : ['--win', 'portable', '--config', 'electron-builder.json'];

function pkgVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${s}s`;
}

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) {
    return 0;
  }
  let sum = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          sum += fs.statSync(full).size;
        } catch {
          /* file vanished mid-scan */
        }
      }
    }
  }
  return sum;
}

function listReleaseArtifacts() {
  if (!fs.existsSync(RELEASE)) {
    return [];
  }
  return fs
    .readdirSync(RELEASE)
    .filter((name) => /\.(exe|7z)$/i.test(name))
    .map((name) => path.join(RELEASE, name));
}

function largestArtifact() {
  const files = listReleaseArtifacts();
  let best = null;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (!best || stat.size > best.size) {
        best = { file, size: stat.size, mtime: stat.mtimeMs };
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

function is7zRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq 7za.exe" /NH', {
      stdio: 'pipe',
      windowsHide: true,
      encoding: 'utf8',
    });
    return out.toLowerCase().includes('7za.exe');
  } catch {
    return false;
  }
}

function estimateTargetBytes(unpackedBytes, compression) {
  if (compression === 'store') {
    return unpackedBytes + 80 * 1024 * 1024;
  }
  if (compression === 'normal') {
    return unpackedBytes * 0.55;
  }
  return unpackedBytes * 0.45;
}

function readCompression() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
    return cfg.compression ?? 'normal';
  } catch {
    return 'normal';
  }
}

const compression = readCompression();
const version = pkgVersion();
let phase = 'starting';
let compressing = false;
let portableStarted = false;
let nsisStarted = false;
let lastLog = '';
const started = Date.now();
let unpackedBytes = 0;
let targetBytes = 0;
let fileCount = 0;

function countFiles(dir) {
  if (!fs.existsSync(dir)) {
    return 0;
  }
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        count += 1;
      }
    }
  }
  return count;
}

function startPortablePhase() {
  if (portableStarted) {
    return;
  }
  portableStarted = true;
  phase = 'portable';
  compressing = true;
  unpackedBytes = dirSizeBytes(UNPACKED);
  fileCount = countFiles(UNPACKED);
  targetBytes = estimateTargetBytes(unpackedBytes, compression);
  console.log(
    `[jarvis] Portable build started — ${fileCount.toLocaleString()} files, ${formatMb(unpackedBytes)}, est. ~${formatMb(targetBytes)}`,
  );
  console.log('[jarvis] Note: portable.exe is built without 7-Zip pre-archive (useZip) — usually 2–5 min, not 15+.');
}

function startNsisPhase() {
  if (nsisStarted) {
    return;
  }
  nsisStarted = true;
  phase = 'nsis';
  compressing = true;
  console.log('[jarvis] NSIS installer build started...');
}

function handleBuilderOutput(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    if (line.includes('packaging')) {
      phase = 'packaging';
    }
    if (/target=portable|building\s+target=portable/i.test(line)) {
      startPortablePhase();
    }
    if (/target=nsis|building\s+target=nsis/i.test(line)) {
      startNsisPhase();
    }
    if (line.includes('block map')) {
      phase = 'finishing';
    }
  }

  if (!portableStarted && /target=portable|building\s+target=portable/i.test(text)) {
    startPortablePhase();
  }
  if (!nsisStarted && /target=nsis|building\s+target=nsis/i.test(text)) {
    startNsisPhase();
  }
}

function detectCompressionFromSystem() {
  if (compressing) {
    return;
  }
  const z7 = is7zRunning();
  const artifact = largestArtifact();
  if (z7 || artifact) {
    if (fs.existsSync(UNPACKED) && !portableStarted && !nsisStarted) {
      startPortablePhase();
      return;
    }
    compressing = true;
    if (phase === 'starting' || phase === 'packaging') {
      phase = 'compressing';
    }
  }
}

function logProgress(force = false) {
  detectCompressionFromSystem();

  const artifact = largestArtifact();
  const portableName = `JARVIS-${version}-portable.exe`;
  const setupName = `JARVIS-${version}-setup.exe`;
  const z7 = is7zRunning();
  const elapsed = formatDuration(Date.now() - started);

  let line = `[jarvis] [${elapsed}] `;

  if (compressing || phase === 'portable' || phase === 'nsis' || phase === 'compressing') {
    if (artifact) {
      const name = path.basename(artifact.file);
      const pct = targetBytes > 0 ? Math.min(99, Math.round((artifact.size / targetBytes) * 100)) : 0;
      line += `${name}: ${formatMb(artifact.size)}`;
      if (pct > 0) {
        line += ` (~${pct}%)`;
      }
      if (z7) {
        line += ' — 7-Zip active';
      }
    } else if (unpackedBytes > 0) {
      line += `7-Zip archiving ${fileCount > 0 ? `${fileCount.toLocaleString()} files / ` : ''}~${formatMb(unpackedBytes)}`;
      if (z7) {
        line += ' — working (exe not written until done)';
      } else {
        line += ' — preparing';
      }
    } else if (z7) {
      line += '7-Zip compressing — output file appears when done';
    } else {
      line += 'Compressing portable — please wait...';
    }
  } else {
    line += `Phase: ${phase}`;
  }

  if (fs.existsSync(path.join(RELEASE, portableName))) {
    line += ' | portable: ready';
  }
  if (fs.existsSync(path.join(RELEASE, setupName))) {
    line += ' | setup: ready';
  }

  if (line !== lastLog || force) {
    console.log(line);
    lastLog = line;
  }
}

console.log('[jarvis] Starting electron-builder with live progress...');
console.log(`[jarvis] Version ${version} | compression: ${compression}`);
console.log('[jarvis] Progress updates every 3 seconds until pack finishes.');

const child = spawn('npx', ['electron-builder', ...packArgs], {
  cwd: ROOT,
  shell: true,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: {
    ...process.env,
    FORCE_COLOR: '1',
    ELECTRON_BUILDER_COMPRESSION_LEVEL: '0',
  },
});

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  handleBuilderOutput(text);
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  handleBuilderOutput(text);
});

const timer = setInterval(() => {
  logProgress();
}, 3000);

logProgress(true);

child.on('close', (code) => {
  clearInterval(timer);
  logProgress(true);
  const portable = path.join(RELEASE, `JARVIS-${version}-portable.exe`);
  const setup = path.join(RELEASE, `JARVIS-${version}-setup.exe`);
  if (fs.existsSync(portable)) {
    console.log(`[jarvis] SUCCESS portable: ${portable} (${formatMb(fs.statSync(portable).size)})`);
  }
  if (fs.existsSync(setup)) {
    console.log(`[jarvis] SUCCESS setup: ${setup} (${formatMb(fs.statSync(setup).size)})`);
  }
  if (code !== 0) {
    console.error(`[jarvis] electron-builder exited with code ${code}`);
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  clearInterval(timer);
  console.error('[jarvis] Failed to start electron-builder:', err.message);
  process.exit(1);
});
