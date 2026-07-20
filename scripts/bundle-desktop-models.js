/**
 * Bundle Ollama + fast local models + Piper voice for offline desktop setup.
 * No API tokens required after install.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUNDLED = path.join(ROOT, 'bundled');
const OLLAMA_APP = path.join(BUNDLED, 'ollama', 'app');
const OLLAMA_MODELS = path.join(BUNDLED, 'ollama', 'models');
const PIPER_CACHE = path.join(BUNDLED, 'piper-cache');
const CHAT_MODEL = process.env.JARVIS_BUNDLE_CHAT_MODEL ?? 'llama3.2:1b';
const EMBED_MODEL = process.env.JARVIS_BUNDLE_EMBED_MODEL ?? 'nomic-embed-text';
const OLLAMA_SETUP_URL = 'https://ollama.com/download/OllamaSetup.exe';

function log(msg) {
  console.log(`[jarvis] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', reject);
  });
}

function ollamaExe(dir) {
  return path.join(dir, process.platform === 'win32' ? 'ollama.exe' : 'ollama');
}

function installedOllamaDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama');
  }
  if (process.platform === 'darwin') {
    return '/Applications/Ollama.app/Contents/Resources';
  }
  return '/usr/local/bin';
}

async function ensureOllamaApp() {
  const targetExe = ollamaExe(OLLAMA_APP);
  if (fs.existsSync(targetExe)) {
    log(`Ollama binary already bundled: ${targetExe}`);
    return targetExe;
  }

  const installed = installedOllamaDir();
  const installedExe = ollamaExe(installed);
  if (fs.existsSync(installedExe)) {
    log(`Copying Ollama from ${installed}`);
    copyDir(installed, OLLAMA_APP);
    return targetExe;
  }

  if (process.platform !== 'win32') {
    throw new Error('Install Ollama first, then re-run bundle-desktop-models.js');
  }

  log('Downloading Ollama installer...');
  const setup = path.join(BUNDLED, 'OllamaSetup.exe');
  await download(OLLAMA_SETUP_URL, setup);
  log('Installing Ollama silently (one-time build step)...');
  spawnSync(setup, ['/S'], { stdio: 'inherit', windowsHide: true });
  await sleep(8000);

  if (!fs.existsSync(installedExe)) {
    throw new Error('Ollama install failed — install manually from https://ollama.com');
  }

  copyDir(installed, OLLAMA_APP);
  try {
    fs.unlinkSync(setup);
  } catch {
    /* ignore */
  }
  log(`Ollama bundled at ${OLLAMA_APP}`);
  return targetExe;
}

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

async function waitForOllama(maxMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const { status } = await get('http://127.0.0.1:11434/api/tags');
      if (status === 200) {
        return true;
      }
    } catch {
      /* retry */
    }
    await sleep(2000);
  }
  return false;
}

async function pullModels(ollamaBin) {
  fs.mkdirSync(OLLAMA_MODELS, { recursive: true });
  const env = { ...process.env, OLLAMA_MODELS: OLLAMA_MODELS };

  let serveProc;
  try {
    const probe = await get('http://127.0.0.1:11434/api/tags').catch(() => null);
    if (!probe || probe.status !== 200) {
      log('Starting Ollama for model download...');
      serveProc = spawn(ollamaBin, ['serve'], { env, stdio: 'ignore', windowsHide: true });
      const up = await waitForOllama();
      if (!up) {
        throw new Error('Ollama did not start for model pull');
      }
    }

    for (const model of [CHAT_MODEL, EMBED_MODEL]) {
      log(`Pulling ${model} (~1–2 GB, one-time)...`);
      const r = spawnSync(ollamaBin, ['pull', model], { env, stdio: 'inherit', windowsHide: true });
      if (r.status !== 0) {
        throw new Error(`ollama pull ${model} failed`);
      }
    }
  } finally {
    if (serveProc) {
      serveProc.kill();
      await sleep(2000);
    }
  }

  log(`Models stored in ${OLLAMA_MODELS}`);
}

async function ensurePiper() {
  log('Bundling Piper voice (~60 MB)...');
  fs.mkdirSync(PIPER_CACHE, { recursive: true });
  const r = spawnSync('node', [path.join(__dirname, 'ensure-piper.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PIPER_CACHE: PIPER_CACHE, PIPER_VOICE: 'en_GB-alan-medium' },
  });
  if (r.status !== 0) {
    throw new Error('Piper bundle failed');
  }
}

async function main() {
  const marker = path.join(BUNDLED, '.bundle-complete');
  const targetExe = ollamaExe(OLLAMA_APP);
  if (
    fs.existsSync(marker) &&
    fs.existsSync(targetExe) &&
    fs.existsSync(OLLAMA_MODELS) &&
    fs.readdirSync(OLLAMA_MODELS).length > 0 &&
    fs.existsSync(path.join(PIPER_CACHE, 'en_GB-alan-medium.onnx'))
  ) {
    log('Offline bundle already present — skipping download.');
    return;
  }

  log('Bundling offline AI models for desktop setup (no API tokens)...');
  log(`Chat model: ${CHAT_MODEL} (optimized for speed)`);

  const ollamaBin = await ensureOllamaApp();
  await pullModels(ollamaBin);
  await ensurePiper();

  fs.writeFileSync(path.join(BUNDLED, '.bundle-complete'), new Date().toISOString(), 'utf8');
  log('Offline model bundle complete.');
  log('Next: npm run desktop:pack:setup');
}

main().catch((err) => {
  console.error(`[jarvis] ${err.message}`);
  process.exit(1);
});
