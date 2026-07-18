const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'release-pack');
const TARGET = path.join(ROOT, 'release');

if (!fs.existsSync(SOURCE)) {
  console.error('[jarvis] release-pack folder not found.');
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fs.mkdirSync(TARGET, { recursive: true });
}

for (const name of fs.readdirSync(SOURCE)) {
  if (!/\.(exe|blockmap)$/i.test(name)) {
    continue;
  }

  const from = path.join(SOURCE, name);
  const to = path.join(TARGET, name);
  fs.copyFileSync(from, to);
  const mb = (fs.statSync(to).size / 1024 / 1024).toFixed(1);
  console.log(`[jarvis] Published ${name} (${mb} MB) -> release/`);
}
