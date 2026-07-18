const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STAGING = `release-staging-${Date.now()}`;
const STAGING_DIR = path.join(ROOT, STAGING);
const RELEASE_DIR = path.join(ROOT, 'release');

function run(command) {
  console.log(`[jarvis] > ${command}`);
  execSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
}

function publishArtifacts() {
  if (!fs.existsSync(STAGING_DIR)) {
    throw new Error(`Staging folder missing: ${STAGING}`);
  }

  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }

  for (const name of fs.readdirSync(STAGING_DIR)) {
    if (!/\.(exe|blockmap)$/i.test(name)) {
      continue;
    }

    const from = path.join(STAGING_DIR, name);
    const to = path.join(RELEASE_DIR, name);
    fs.copyFileSync(from, to);
    const mb = (fs.statSync(to).size / 1024 / 1024).toFixed(1);
    console.log(`[jarvis] Published ${name} (${mb} MB) -> release/`);
  }
}

try {
  run('npm run build:desktop:pack');
  run(`node scripts/pre-pack-release.js --release-dir=${STAGING}`);
  run(
    `node scripts/pack-with-progress.js --win --config electron-builder.json -c.directories.output=${STAGING}`,
  );
  publishArtifacts();
  run('npm install --prefix backend');
  console.log(`[jarvis] desktop:pack:all complete (staging: ${STAGING})`);
} catch (error) {
  console.error(`[jarvis] desktop:pack:all failed: ${error?.message ?? error}`);
  process.exit(1);
}
