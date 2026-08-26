import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envPath = join(root, 'backend', '.env');
const envContent = readFileSync(envPath, 'utf8');
const vars = {};

for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    continue;
  }
  const idx = trimmed.indexOf('=');
  if (idx === -1) {
    continue;
  }
  vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

const VERCEL_VARS = [
  'LLM_PROVIDER',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_FALLBACK_MODELS',
  'GEMINI_BASE_URL',
  'GEMINI_EMBED_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_FALLBACK_MODELS',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GROQ_FALLBACK_MODELS',
  'GROQ_BASE_URL',
  'EMBED_PROVIDER',
  'JARVIS_APP_URL',
  'JARVIS_APP_NAME',
  'DATABASE_URL',
  'TAVILY_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'VERCEL_TOKEN',
  'VERCEL_PROJECT_ID',
  'JARVIS_MAX_SKILL_TIER',
  'JARVIS_SERVERLESS',
  'JARVIS_LLM_ENSURE',
  'JARVIS_LESSONS_TOP_N',
  'JARVIS_LESSONS_MIN_CONFIDENCE',
  'JARVIS_LESSONS_MERGE_THRESHOLD',
  'JARVIS_LESSONS_STALE_DAYS',
];

const defaults = {
  JARVIS_SERVERLESS: '1',
  JARVIS_LLM_ENSURE: 'off',
  JARVIS_MAX_SKILL_TIER: 'sandbox',
  JARVIS_LESSONS_TOP_N: '3',
  JARVIS_LESSONS_MIN_CONFIDENCE: '0.55',
  JARVIS_LESSONS_MERGE_THRESHOLD: '0.85',
  JARVIS_LESSONS_STALE_DAYS: '30',
};

const results = { ok: [], skip: [], fail: [] };

for (const name of VERCEL_VARS) {
  const value = vars[name] || defaults[name];
  if (!value) {
    results.skip.push(name);
    continue;
  }
  try {
    execFileSync(
      'npx',
      ['vercel', 'env', 'add', name, 'production,preview', '--force', '--yes', '--sensitive'],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], input: value, shell: true },
    );
    results.ok.push(name);
  } catch (error) {
    results.fail.push({ name, error: error.stderr?.toString()?.slice(0, 200) || error.message });
  }
}

console.log(JSON.stringify(results, null, 2));
