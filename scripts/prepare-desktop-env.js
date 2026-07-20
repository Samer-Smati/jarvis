/**
 * Write backend/.env for offline desktop installer (no API tokens).
 */
const fs = require('fs');
const path = require('path');

const bundledModels = path.join(__dirname, '..', 'bundled', 'ollama', 'models');
const hasBundled = fs.existsSync(bundledModels);

const envPath = path.join(__dirname, '..', 'backend', '.env');

const lines = [
  '# Auto-generated for offline desktop installer',
  'LLM_PROVIDER=ollama',
  'EMBED_PROVIDER=ollama',
  'OLLAMA_BASE_URL=http://127.0.0.1:11434',
  'OLLAMA_CHAT_MODEL=llama3.2:1b',
  'OLLAMA_EMBED_MODEL=nomic-embed-text',
  'JARVIS_LLM_ENSURE=full',
  'JARVIS_DEFER_PIPER=0',
  'JARVIS_PERFORMANCE_MODE=1',
  'WHISPER_MODEL=Xenova/whisper-tiny',
  'TTS_ENGINE=piper',
  'PIPER_VOICE=en_US-lessac-medium',
  'PORT=3000',
  'CORS_ORIGIN=http://127.0.0.1:3847',
  '',
];

if (!hasBundled) {
  console.warn('[jarvis] bundled/ollama/models missing — run scripts/bundle-desktop-models.js first');
}

fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
console.log(`[jarvis] Desktop env written: ${envPath}`);
