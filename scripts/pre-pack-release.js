const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const releaseArg = process.argv.find((arg) => arg.startsWith('--release-dir='));
const RELEASE = path.join(ROOT, releaseArg?.split('=')[1] ?? process.env.JARVIS_RELEASE ?? 'release');
const UNPACKED = path.join(RELEASE, 'win-unpacked');

function sleep(ms) {
  try {
    execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds ' + ms + '"', {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* fallback */
    }
  }
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function stopLockingProcesses() {
  if (process.platform !== 'win32') {
    return;
  }

  for (const exe of ['7za.exe', 'electron-builder.exe', 'J.A.R.V.I.S.exe', 'app-builder.exe', 'electron.exe']) {
    run(`taskkill /F /IM ${exe}`);
  }

  run(
    'powershell -NoProfile -Command "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like \'JARVIS*\' -or $_.ProcessName -eq \'J.A.R.V.I.S\' } | Stop-Process -Force -ErrorAction SilentlyContinue"',
  );

  for (const exe of fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE).filter((n) => n.endsWith('-portable.exe')) : []) {
    run(`taskkill /F /IM "${exe}"`);
  }
}

function removePath(target, label) {
  if (!fs.existsSync(target)) {
    return true;
  }

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
      if (!fs.existsSync(target)) {
        console.log(`[jarvis] Removed ${label}`);
        return true;
      }
    } catch {
      /* retry */
    }

    console.log(`[jarvis] ${label} locked — stopping JARVIS processes (attempt ${attempt}/8)...`);
    stopLockingProcesses();
    sleep(2000);
  }

  try {
    const quarantine = `${target}-old-${Date.now()}`;
    fs.renameSync(target, quarantine);
    console.log(`[jarvis] Quarantined locked ${label} to ${path.basename(quarantine)}`);
    return true;
  } catch {
    return !fs.existsSync(target);
  }
}

if (!fs.existsSync(RELEASE)) {
  fs.mkdirSync(RELEASE, { recursive: true });
  process.exit(0);
}

console.log('[jarvis] Preparing release folder for pack...');
stopLockingProcesses();
sleep(1000);

if (!removePath(UNPACKED, `${path.basename(RELEASE)}/win-unpacked`)) {
  console.error(`[jarvis] Cannot clear ${path.basename(RELEASE)}\\win-unpacked — close all JARVIS windows and end J.A.R.V.I.S / Node tasks in Task Manager, then retry.`);
  process.exit(1);
}

for (const name of fs.readdirSync(RELEASE)) {
  if (!name.endsWith('.7z') && !name.endsWith('.blockmap')) {
    continue;
  }
  const file = path.join(RELEASE, name);
  try {
    const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
    fs.unlinkSync(file);
    console.log(`[jarvis] Removed pack cache: ${name} (${mb} MB)`);
  } catch {
    console.warn(`[jarvis] Could not remove ${name} — still locked.`);
  }
}

console.log('[jarvis] Release folder ready for electron-builder.');
