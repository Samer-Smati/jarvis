/**
 * Human-like E2E tests — clicks through real UI like a user (desktop + mobile viewports).
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = Number(process.env.JARVIS_PORT ?? 3847);
const publicDir = path.join(root, 'backend', 'public', 'index.html');

function waitForHealth(maxMs = 90000) {
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

function prepareUi() {
  if (fs.existsSync(publicDir)) {
    return;
  }
  spawnSync('npm', ['run', 'build', '--prefix', 'frontend', '--', '--configuration', 'development'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  spawnSync('node', ['scripts/copy-frontend.js'], { cwd: root, stdio: 'inherit', shell: true });
}

async function main() {
  console.log('\n=== JARVIS Human E2E Tests ===\n');
  prepareUi();

  const backend = spawn('npm', ['run', 'start:prod', '--prefix', 'backend'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      FRONTEND_PATH: path.join(root, 'backend', 'public'),
      LLM_PROVIDER: process.env.LLM_PROVIDER ?? 'groq',
      JARVIS_LLM_ENSURE: 'off',
      JARVIS_DEFER_PIPER: '1',
    },
    stdio: 'ignore',
    shell: true,
    windowsHide: true,
  });

  const up = await waitForHealth();
  if (!up) {
    backend.kill();
    console.error('FAIL — Backend did not start');
    process.exit(1);
  }

  const r = spawnSync(
    'npx',
    ['playwright', 'test', '--config=playwright.config.ts', '--project=desktop-chrome', '--project=mobile-android'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, JARVIS_TEST_URL: `http://127.0.0.1:${PORT}`, JARVIS_PORT: String(PORT) },
    },
  );

  backend.kill();
  process.exit(r.status ?? 1);
}

main();
