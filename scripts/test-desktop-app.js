/**
 * Desktop app smoke test — launches Electron (not the web browser).
 * Usage: node scripts/test-desktop-app.js [--remote]
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.JARVIS_PORT ?? 3847);
const REMOTE = process.argv.includes('--remote');
const BOOT_TIMEOUT_MS = 120000;
const TARGET_BOOT_MS = 15000;
const TARGET_RSS_MB = 800;

function readBootLog(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

function probeHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function treeMemoryMb(rootPid) {
  if (!rootPid) {
    return null;
  }
  try {
    const script = `
      $root = ${rootPid}
      $pids = @($root)
      $queue = @($root)
      while ($queue.Count -gt 0) {
        $p = $queue[0]; $queue = $queue[1..($queue.Count-1)]
        Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" | ForEach-Object {
          if ($pids -notcontains $_.ProcessId) { $pids += $_.ProcessId; $queue += $_.ProcessId }
        }
      }
      ($pids | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).WorkingSet64 } | Measure-Object -Sum).Sum
    `;
    const out = execSync(`powershell -NoProfile -Command "${script.replace(/\n/g, ' ')}"`, { encoding: 'utf8' }).trim();
    const bytes = Number(out);
    return Number.isFinite(bytes) ? Math.round(bytes / 1024 / 1024) : null;
  } catch {
    return null;
  }
}

async function waitForBoot(child, logPath) {
  const started = Date.now();
  const baselineLog = readBootLog(logPath);
  while (Date.now() - started < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      const log = readBootLog(logPath);
      if (log.includes('smoke test complete') || log.includes('boot complete in')) {
        const match = log.match(/boot complete in (\d+)ms/);
        return { ok: true, ms: match ? Number(match[1]) : Date.now() - started, reason: 'boot complete (post-exit)' };
      }
      return { ok: false, ms: Date.now() - started, reason: `Electron exited (${child.exitCode})` };
    }
    const log = readBootLog(logPath);
    const delta = log.slice(baselineLog.length);
    if (delta.includes('smoke test complete')) {
      return { ok: true, ms: Date.now() - started, reason: 'smoke complete' };
    }
    if (delta.includes('boot complete in')) {
      const match = delta.match(/boot complete in (\d+)ms/);
      return { ok: true, ms: match ? Number(match[1]) : Date.now() - started, reason: 'boot complete' };
    }
    if (delta.includes('Startup failed') || delta.includes('Cloud backend unreachable')) {
      return { ok: false, ms: Date.now() - started, reason: 'boot failed' };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, ms: BOOT_TIMEOUT_MS, reason: 'timeout' };
}

async function main() {
  console.log(`\n=== JARVIS Desktop App Test (${REMOTE ? 'remote/Vercel' : 'local backend'}) ===\n`);

  const electron = require('electron');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-desktop-smoke-'));
  const bootLogPath = path.join(userDataDir, 'boot.log');

  const env = {
    ...process.env,
    JARVIS_SMOKE_TEST: '1',
    JARVIS_LLM_ENSURE: 'off',
    JARVIS_DEFER_PIPER: '1',
    JARVIS_PERFORMANCE_MODE: '1',
    JARVIS_REMOTE: REMOTE ? '1' : 'local',
  };

  const started = Date.now();
  const child = spawn(
    electron,
    [path.join(__dirname, '..', 'desktop', 'main.js'), `--user-data-dir=${userDataDir}`],
    { env, stdio: 'ignore', windowsHide: true },
  );

  await new Promise((r) => setTimeout(r, 1500));
  const memPeak = treeMemoryMb(child.pid);

  const boot = await waitForBoot(child, bootLogPath);
  const memAfter = treeMemoryMb(child.pid);
  const healthOk = REMOTE ? true : await probeHealth();

  if (child.exitCode === null) {
    child.kill();
  }

  console.log(`Boot: ${boot.ok ? 'PASS' : 'FAIL'} — ${boot.reason} (${boot.ms}ms)`);
  console.log(boot.ms <= TARGET_BOOT_MS ? `  Startup ≤ ${TARGET_BOOT_MS}ms target` : `  WARN startup ${boot.ms}ms > ${TARGET_BOOT_MS}ms`);

  if (!REMOTE) {
    console.log(`Backend health: ${healthOk ? 'PASS' : 'FAIL'}`);
  }

  const mem = memAfter ?? memPeak;
  if (mem != null) {
    console.log(`Desktop process tree RAM: ~${mem}MB`);
    console.log(mem <= TARGET_RSS_MB ? `  ≤ ${TARGET_RSS_MB}MB target` : `  WARN > ${TARGET_RSS_MB}MB target`);
  }

  console.log(`Total test duration: ${Date.now() - started}ms`);
  console.log(`Boot log: ${bootLogPath}\n`);

  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  process.exit(boot.ok && (REMOTE || healthOk) ? 0 : 1);
}

main();
