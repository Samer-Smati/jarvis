/**
 * Run desktop + mobile app smoke tests (not frontend unit tests).
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'backend', 'public', 'index.html');
const PORT = Number(process.env.JARVIS_PORT ?? 3847);

function run(cmd, args, env = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: true });
  return r.status ?? 1;
}

function prepareUi() {
  if (fs.existsSync(publicDir)) {
    console.log('UI already built in backend/public');
    return 0;
  }
  console.log('Building UI for desktop/mobile app test...');
  let code = run('npm', ['run', 'build', '--prefix', 'frontend', '--', '--configuration', 'development']);
  if (code !== 0) {
    return code;
  }
  return run('node', ['scripts/copy-frontend.js']);
}

function waitForHealth(maxMs = 60000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }).on('error', () => {
        if (Date.now() - started > maxMs) {
          resolve(false);
        } else {
          setTimeout(tick, 1000);
        }
      });
    };
    tick();
  });
}

async function main() {
  const prep = prepareUi();
  if (prep !== 0) {
    process.exit(prep);
  }

  console.log('Starting backend for mobile app test...');
  const backend = spawn('npm', ['run', 'start:prod', '--prefix', 'backend'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      FRONTEND_PATH: path.join(root, 'backend', 'public'),
      JARVIS_LLM_ENSURE: 'off',
      JARVIS_DEFER_PIPER: '1',
      JARVIS_PERFORMANCE_MODE: '1',
      LLM_PROVIDER: 'claude',
    },
    stdio: 'ignore',
    shell: true,
    windowsHide: true,
  });

  const up = await waitForHealth();
  if (!up) {
    backend.kill();
    console.error('Backend failed to start for mobile test');
    process.exit(1);
  }

  const mobile = run('node', ['scripts/test-mobile-app.js']);
  backend.kill();
  await new Promise((r) => setTimeout(r, 2000));

  const desktop = run('node', ['scripts/test-desktop-app.js']);
  process.exit(desktop === 0 && mobile === 0 ? 0 : 1);
}

main();
