process.env.JARVIS_REMOTE = process.env.JARVIS_REMOTE ?? '1';
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const child = spawn(electron, [path.join(__dirname, '..', 'desktop', 'main.js')], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 0));
