const fs = require('fs');
const path = require('path');

const RELEASE = path.join(__dirname, '..', 'release');
const UNPACKED = path.join(RELEASE, 'win-unpacked');
const EXE = path.join(UNPACKED, 'J.A.R.V.I.S.exe');

if (!fs.existsSync(EXE)) {
  console.error('[jarvis] Missing release/win-unpacked/J.A.R.V.I.S.exe — run desktop:pack:dir first.');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const bat = `@echo off\r\nstart "" "%~dp0win-unpacked\\J.A.R.V.I.S.exe"\r\n`;
const batPath = path.join(RELEASE, 'Start-JARVIS.bat');

fs.writeFileSync(batPath, bat, 'utf8');
console.log(`[jarvis] Created ${batPath}`);
console.log(`[jarvis] Ready: double-click Start-JARVIS.bat or win-unpacked\\J.A.R.V.I.S.exe (v${version})`);
