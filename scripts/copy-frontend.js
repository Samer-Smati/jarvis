/** Copies the Angular production build into backend/public for desktop/single-server mode. */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'frontend', 'dist', 'frontend', 'browser');
const dest = path.join(__dirname, '..', 'backend', 'public');

if (!fs.existsSync(src)) {
  console.error('[jarvis] Frontend build not found. Run: npm run build --prefix frontend');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[jarvis] Frontend copied to ${dest}`);
