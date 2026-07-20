/**
 * Ensures a local LLM is running before JARVIS starts.
 * Modes: JARVIS_LLM_ENSURE=off|probe|full (default probe — no auto model load).
 */
const { execSync, spawn } = require('child_process');
const http = require('http');
const https = require('https');

const ENSURE_MODE = process.env.JARVIS_LLM_ENSURE ?? 'probe';
const LMSTUDIO_BASE = (process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1').replace(/\/$/, '');
const PREFERRED_CHAT = process.env.LMSTUDIO_CHAT_MODEL || 'qwen/qwen3.5-9b';
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_CHAT = process.env.OLLAMA_CHAT_MODEL || 'llama3.2:1b';
const OLLAMA_BIN = process.env.OLLAMA_BIN?.trim();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(cmd, silent = false) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: silent ? ['pipe', 'pipe', 'pipe'] : 'inherit',
      shell: true,
      windowsHide: true,
    });
  } catch (error) {
    return error.stdout?.toString?.() ?? '';
  }
}

function hasCmd(name) {
  const check = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
  const out = run(check, true);
  return out.trim().length > 0 && !out.toLowerCase().includes('not found');
}

function get(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, json: null });
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

async function probeLmStudio() {
  try {
    const { status, json } = await get(`${LMSTUDIO_BASE}/models`, 4000);
    if (status === 200 && json?.data?.length) {
      const chat = json.data.filter((m) => !String(m.id).toLowerCase().includes('embed'));
      const model = chat.find((m) => m.id === PREFERRED_CHAT)?.id ?? chat[0]?.id ?? PREFERRED_CHAT;
      console.log(`[jarvis] LM Studio online — ${model}`);
      process.env.LMSTUDIO_CHAT_MODEL = model;
      return true;
    }
  } catch {
    /* offline */
  }
  return false;
}

async function probeOllama() {
  try {
    const { status, json } = await get(`${OLLAMA_BASE}/api/tags`, 4000);
    if (status === 200 && json?.models?.length) {
      const names = json.models.map((m) => m.name);
      const match = names.find((n) => n.startsWith(OLLAMA_CHAT)) ?? names[0];
      console.log(`[jarvis] Ollama online — ${match}`);
      process.env.OLLAMA_CHAT_MODEL = match.replace(/:latest$/, '');
      return true;
    }
  } catch {
    /* offline */
  }
  return false;
}

async function waitForModels(maxMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const { status, json } = await get(`${LMSTUDIO_BASE}/models`);
      if (status === 200 && json?.data?.length) {
        return json.data;
      }
    } catch {
      /* retry */
    }
    await sleep(2000);
  }
  throw new Error('LM Studio API did not become ready in time.');
}

function pickChatModel(models) {
  const chat = models.filter((m) => !String(m.id).toLowerCase().includes('embed'));
  if (!chat.length) {
    return PREFERRED_CHAT;
  }
  const preferred = chat.find((m) => m.id === PREFERRED_CHAT);
  if (preferred) {
    return preferred.id;
  }
  return chat[0].id;
}

async function ensureLmStudioFull() {
  if (!hasCmd('lms')) {
    console.log('[jarvis] LM Studio CLI (lms) not found — skipping.');
    return false;
  }

  let models;
  try {
    models = await waitForModels(5000);
    console.log('[jarvis] LM Studio already online.');
  } catch {
    console.log('[jarvis] Starting LM Studio server...');
    run('lms server start', true);
    models = await waitForModels(90000);
  }

  const chatModel = pickChatModel(models);
  const loaded = models.some((m) => m.id === chatModel);
  if (!loaded) {
    console.log(`[jarvis] Loading chat model: ${chatModel} (this may take ~30s)...`);
    run(`lms load ${chatModel}`, true);
    await sleep(8000);
    models = await waitForModels(120000);
  }

  const final = pickChatModel(models);
  console.log(`[jarvis] Neural core online — ${final}`);
  process.env.LMSTUDIO_CHAT_MODEL = final;
  return true;
}

async function ensureOllamaFull() {
  const bin = OLLAMA_BIN || 'ollama';
  const hasBin =
    OLLAMA_BIN && (OLLAMA_BIN.includes('/') || OLLAMA_BIN.includes('\\'))
      ? require('fs').existsSync(OLLAMA_BIN)
      : hasCmd(bin.replace(/\.exe$/i, '')) || (OLLAMA_BIN && require('fs').existsSync(OLLAMA_BIN));
  if (!hasBin) {
    return false;
  }
  try {
    await get(`${OLLAMA_BASE}/api/tags`, 5000);
  } catch {
    console.log('[jarvis] Starting Ollama...');
    const env = { ...process.env };
    if (process.env.OLLAMA_MODELS) {
      env.OLLAMA_MODELS = process.env.OLLAMA_MODELS;
    }
    if (OLLAMA_BIN) {
      spawn(OLLAMA_BIN, ['serve'], { env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      run('ollama serve', true);
    }
    await sleep(4000);
  }

  let tags;
  try {
    ({ json: tags } = await get(`${OLLAMA_BASE}/api/tags`));
  } catch {
    return false;
  }

  const names = (tags?.models ?? []).map((m) => m.name);
  const hasChat = names.some((n) => n.startsWith(OLLAMA_CHAT));
  if (!hasChat && names.length) {
    console.log(`[jarvis] Ollama fallback model available: ${names[0]}`);
    process.env.OLLAMA_CHAT_MODEL = names[0].replace(/:latest$/, '');
    return true;
  }
  if (hasChat) {
    console.log(`[jarvis] Ollama online — ${OLLAMA_CHAT}`);
    return true;
  }
  return false;
}

async function main() {
  console.log(`[jarvis] LLM ensure mode: ${ENSURE_MODE}`);

  if (ENSURE_MODE === 'off') {
    console.log('[jarvis] LLM ensure skipped.');
    process.exit(0);
  }

  if (ENSURE_MODE === 'probe') {
    console.log('[jarvis] Probing local AI runtimes (no auto-start)...');
    if (process.env.JARVIS_BUNDLED_OLLAMA_DIR) {
      const ollamaOk = await probeOllama();
      if (ollamaOk) {
        console.log('[jarvis] Ready. Provider: ollama (bundled)');
        process.exit(0);
      }
    }
    const lmOk = await probeLmStudio();
    if (lmOk) {
      console.log('[jarvis] Ready. Provider: lmstudio');
      process.exit(0);
    }
    const ollamaOk = await probeOllama();
    if (ollamaOk) {
      console.log('[jarvis] Ready. Provider: ollama (fallback)');
      process.exit(0);
    }
    console.warn('[jarvis] No local LLM detected. Start LM Studio or Ollama manually.');
    process.exit(0);
  }

  console.log('[jarvis] Full ensure — scanning local AI runtimes...');
  if (process.env.JARVIS_BUNDLED_OLLAMA_DIR || process.env.OLLAMA_BIN) {
    const ollamaOk = await ensureOllamaFull().catch(() => false);
    if (ollamaOk) {
      console.log('[jarvis] Ready. Provider: ollama (bundled)');
      process.exit(0);
    }
  }
  const lmOk = await ensureLmStudioFull().catch((e) => {
    console.warn(`[jarvis] LM Studio setup failed: ${e.message}`);
    return false;
  });

  if (lmOk) {
    console.log('[jarvis] Ready. Provider: lmstudio');
    process.exit(0);
  }

  const ollamaOk = await ensureOllamaFull().catch(() => false);
  if (ollamaOk) {
    console.log('[jarvis] Ready. Provider: ollama (fallback)');
    process.exit(0);
  }

  console.error('[jarvis] No local LLM available.');
  process.exit(1);
}

main();
