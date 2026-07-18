const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;

execSync(`npx electron-rebuild -f -w better-sqlite3 -m backend --version=${electronVersion}`, {
  cwd: root,
  stdio: 'inherit',
});

console.log(`[jarvis] Rebuilt better-sqlite3 for Electron ${electronVersion}`);
