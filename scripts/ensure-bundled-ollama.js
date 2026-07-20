/**
 * Start bundled Ollama and warm the chat model for fast first response.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const bundledDir = process.env.JARVIS_BUNDLED_OLLAMA_DIR;
const ollamaBin = process.env.OLLAMA_BIN;
const modelsDir = process.env.OLLAMA_MODELS;
const chatModel = process.env.OLLAMA_CHAT_MODEL ?? 'llama3.2:1b';
const baseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');

function log(msg) {
  console.log(`[jarvis] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function get(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, json: null, body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function post(url, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(data);
    req.end();
  });
}

async function waitForOllama(maxMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const { status } = await get(`${baseUrl}/api/tags`, 4000);
      if (status === 200) {
        return true;
      }
    } catch {
      /* retry */
    }
    await sleep(1500);
  }
  return false;
}

function startOllamaServe() {
  if (!ollamaBin || !fs.existsSync(ollamaBin)) {
    throw new Error(`Bundled Ollama binary missing: ${ollamaBin ?? '(unset)'}`);
  }
  fs.mkdirSync(modelsDir, { recursive: true });
  const env = {
    ...process.env,
    OLLAMA_MODELS: modelsDir,
  };
  log(`Starting bundled Ollama: ${ollamaBin}`);
  const child = spawn(ollamaBin, ['serve'], {
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function warmModel() {
  log(`Warming model ${chatModel} (keep loaded for fast replies)...`);
  await post(`${baseUrl}/api/generate`, {
    model: chatModel,
    prompt: 'Hello',
    stream: false,
    keep_alive: '24h',
    options: {
      num_predict: 8,
      num_ctx: 2048,
    },
  });
  log(`Model ${chatModel} ready.`);
}

async function main() {
  if (!bundledDir || !fs.existsSync(bundledDir)) {
    log('No bundled Ollama directory — skipping.');
    process.exit(0);
  }

  let online = false;
  try {
    const { status } = await get(`${baseUrl}/api/tags`, 3000);
    online = status === 200;
  } catch {
    online = false;
  }

  if (!online) {
    startOllamaServe();
    online = await waitForOllama(90000);
  }

  if (!online) {
    console.error('[jarvis] Bundled Ollama did not start.');
    process.exit(1);
  }

  try {
    const { json } = await get(`${baseUrl}/api/tags`);
    const names = (json?.models ?? []).map((m) => m.name.replace(/:latest$/, ''));
    const hasChat = names.some((n) => n === chatModel || n.startsWith(`${chatModel}:`));
    if (!hasChat) {
      log(`Pulling ${chatModel} into bundled store...`);
      spawnSync(ollamaBin, ['pull', chatModel], {
        env: { ...process.env, OLLAMA_MODELS: modelsDir },
        stdio: 'inherit',
        windowsHide: true,
      });
    }
  } catch (err) {
    console.error(`[jarvis] Model check failed: ${err.message}`);
    process.exit(1);
  }

  await warmModel().catch((err) => {
    log(`Warm-up skipped: ${err.message}`);
  });

  log('Bundled Ollama online.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
