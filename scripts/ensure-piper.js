/**
 * Ensures Piper TTS binary and default voice model are available locally.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const VOICE = process.env.PIPER_VOICE || 'en_GB-alan-medium';
const CACHE = path.resolve(process.env.PIPER_CACHE || path.join(__dirname, '..', 'data', 'piper-cache'));
const PIPER_DIR = path.join(CACHE, 'piper');

function findPiperExe(dir) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && (entry.name === 'piper.exe' || entry.name === 'piper')) {
      return full;
    }
    if (entry.isDirectory()) {
      const nested = findPiperExe(full);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

const PIPER_EXE = path.join(PIPER_DIR, process.platform === 'win32' ? 'piper.exe' : 'piper');
const MODEL_ONNX = path.join(CACHE, `${VOICE}.onnx`);
const MODEL_JSON = path.join(CACHE, `${VOICE}.onnx.json`);

const PIPER_RELEASE =
  process.platform === 'win32'
    ? 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip'
    : process.platform === 'darwin'
      ? 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_aarch64.tar.gz'
      : 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz';

const VOICE_PATHS = {
  'en_GB-alan-medium': 'en/en_GB/alan/medium/en_GB-alan-medium',
};

function voiceModelBase(voice) {
  const rel = VOICE_PATHS[voice] ?? `en/en_GB/alan/medium/${voice}`;
  return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${rel}`;
}

const MODEL_BASE = voiceModelBase(VOICE);

function log(msg) {
  console.log(`[jarvis] ${msg}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed ${res.statusCode}: ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', reject);
  });
}

function extractArchive(archivePath) {
  fs.mkdirSync(PIPER_DIR, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${PIPER_DIR.replace(/'/g, "''")}' -Force"`,
      { stdio: 'inherit', windowsHide: true },
    );
  } else {
    execSync(`tar -xf "${archivePath}" -C "${PIPER_DIR}"`, { stdio: 'inherit' });
  }
}

function resolvedPiperExe() {
  return findPiperExe(PIPER_DIR);
}

async function ensurePiperBinary() {
  const existing = resolvedPiperExe();
  if (existing) {
    log(`Piper binary ready at ${existing}`);
    return true;
  }
  if (process.env.PIPER_BIN && fs.existsSync(process.env.PIPER_BIN)) {
    log(`Using PIPER_BIN=${process.env.PIPER_BIN}`);
    return true;
  }

  log('Downloading Piper TTS binary...');
  fs.mkdirSync(CACHE, { recursive: true });
  const archive = path.join(CACHE, path.basename(PIPER_RELEASE));
  await download(PIPER_RELEASE, archive);
  extractArchive(archive);
  try {
    fs.unlinkSync(archive);
  } catch {
    /* ignore */
  }

  if (!resolvedPiperExe()) {
    log('Piper binary not found after extract — install manually or set PIPER_BIN.');
    return false;
  }
  log(`Piper binary installed at ${resolvedPiperExe()}.`);
  return true;
}

async function ensureVoiceModel() {
  const jsonOk = fs.existsSync(MODEL_JSON) && fs.statSync(MODEL_JSON).size > 32;
  if (fs.existsSync(MODEL_ONNX) && jsonOk) {
    log(`Voice model ready: ${VOICE}`);
    return true;
  }

  log(`Downloading Piper voice: ${VOICE} (~50 MB)...`);
  fs.mkdirSync(CACHE, { recursive: true });
  await download(`${MODEL_BASE}.onnx`, MODEL_ONNX);
  await download(`${MODEL_BASE}.onnx.json`, MODEL_JSON);
  if (!fs.existsSync(MODEL_JSON) || fs.statSync(MODEL_JSON).size < 32) {
    throw new Error('Voice config download failed or is empty.');
  }
  log('Voice model downloaded.');
  return true;
}

async function main() {
  log('Ensuring Piper TTS...');
  fs.mkdirSync(CACHE, { recursive: true });

  const binOk = await ensurePiperBinary().catch((e) => {
    log(`Piper binary setup failed: ${e.message}`);
    return false;
  });
  const modelOk = await ensureVoiceModel().catch((e) => {
    log(`Voice model setup failed: ${e.message}`);
    return false;
  });

  if (binOk && modelOk) {
    log('Piper TTS ready.');
    process.exit(0);
  }
  log('Piper TTS incomplete — browser TTS fallback will be used.');
  process.exit(0);
}

main();
