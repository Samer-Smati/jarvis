#!/usr/bin/env node
/**
 * Activate or rollback a LoRA adapter in llm-routing.config.json (desktop).
 * Usage: node scripts/activate-adapter.js --path models/adapters/jarvis-2026-07-28 --confirm
 * Rollback: node scripts/activate-adapter.js --rollback
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const rollback = args.includes('--rollback');
const pathIdx = args.indexOf('--path');
const adapterPath = pathIdx >= 0 ? args[pathIdx + 1] : '';

const configPath = path.join(__dirname, '..', 'backend', 'src', 'llm', 'llm-routing.config.json');
const backupPath = configPath + '.backup';
const metaPath = configPath + '.backup.meta.json';

function loadConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfigAtomic(cfg) {
  const dir = path.dirname(configPath);
  const tmp = path.join(dir, `.llm-routing.config.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, configPath);
}

function saveBackup(cfg) {
  fs.writeFileSync(backupPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ savedAt: new Date().toISOString(), hostname: os.hostname() }, null, 2) + '\n',
    'utf8',
  );
}

if (rollback) {
  if (!fs.existsSync(backupPath)) {
    console.error('No backup found — cannot rollback.');
    process.exit(1);
  }
  const restored = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  delete restored._activeAdapter;
  writeConfigAtomic(restored);
  console.log('Rolled back llm-routing.config.json to pre-activation state.');
  console.log(
    'personal.desktop route:',
    restored.routes?.personal?.desktop?.provider,
    '/',
    restored.routes?.personal?.desktop?.model,
  );
  process.exit(0);
}

if (!confirm || !adapterPath) {
  console.error('Usage: node scripts/activate-adapter.js --path <adapter-dir> --confirm');
  process.exit(1);
}

const resolvedAdapter = path.resolve(adapterPath);
if (!fs.existsSync(resolvedAdapter)) {
  console.error(`Adapter path not found: ${resolvedAdapter}`);
  process.exit(1);
}

const before = loadConfig();
saveBackup(before);

const cfg = loadConfig();
cfg.routes.personal.desktop.model = 'jarvis-personal';
cfg.routes.personal.desktop.provider = 'ollama';
cfg._activeAdapter = resolvedAdapter;

try {
  writeConfigAtomic(cfg);
} catch (error) {
  console.error('Activation failed mid-write — restoring backup.');
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, configPath);
  }
  throw error;
}

console.log(`Activated adapter ${resolvedAdapter}. Ollama model name: jarvis-personal`);
console.log('Backup saved to', backupPath);
console.log('Rollback with: node scripts/activate-adapter.js --rollback');
console.log('Create Modelfile: FROM <base> ADAPTER', resolvedAdapter);
