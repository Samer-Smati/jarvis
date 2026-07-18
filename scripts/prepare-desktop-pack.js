const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend');
const NM = path.join(BACKEND, 'node_modules');
const HF = path.join(NM, '@huggingface');
const NESTED_BACKEND = path.join(NM, 'backend');
const MARKER = path.join(BACKEND, '.desktop-pack-slim');

const SLIM_DIRS = [
  HF,
  NESTED_BACKEND,
  path.join(NM, 'jarvis'),
  path.join(NM, 'onnxruntime-node'),
  path.join(NM, 'onnxruntime-web'),
];

for (const dir of SLIM_DIRS) {
  if (!fs.existsSync(dir)) {
    continue;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const label = path.relative(NM, dir);
  console.log(`[jarvis] Desktop pack: excluded ${label}`);
}

require('./slim-node-modules.js');

fs.writeFileSync(MARKER, new Date().toISOString(), 'utf8');
console.log('[jarvis] Desktop pack: slim node_modules ready for faster 7-Zip pack.');
