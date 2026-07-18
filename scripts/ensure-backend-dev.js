const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const backendRoot = path.join(__dirname, '..', 'backend');
const nestCli = path.join(backendRoot, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js');

if (fs.existsSync(nestCli)) {
  process.exit(0);
}

console.log('[jarvis] Restoring backend dev dependencies (@nestjs/cli missing)...');
execSync('npm install', { cwd: backendRoot, stdio: 'inherit' });
