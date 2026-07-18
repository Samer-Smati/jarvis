const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const backendRoot = path.join(root, 'backend');
const sqliteModule = path.join(backendRoot, 'node_modules', 'better-sqlite3');

if (!fs.existsSync(electronExe)) {
  console.error('[jarvis] Electron not installed. Run npm install at project root.');
  process.exit(1);
}

if (!fs.existsSync(sqliteModule)) {
  console.error('[jarvis] better-sqlite3 missing in backend/node_modules.');
  process.exit(1);
}

const probe = `
const sqlite = require('better-sqlite3');
const db = sqlite(':memory:');
db.prepare('select 1 as ok').get();
console.log('native ok');
`;

const result = spawnSync(electronExe, ['-e', probe], {
  cwd: backendRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
});

if (result.status === 0) {
  console.log('[jarvis] Native check passed: better-sqlite3 loads under Electron.');
  process.exit(0);
}

console.error('[jarvis] Native check FAILED — better-sqlite3 cannot load under Electron.');
if (result.stderr) {
  console.error(result.stderr.trim());
}
process.exit(1);
