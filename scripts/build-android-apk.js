/**
 * Build JARVIS Android APK (Capacitor) — no Android Studio required.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const frontend = path.join(root, 'frontend');
const androidDir = path.join(frontend, 'android');
const releaseApk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const outDir = path.join(root, 'release');
const outApk = path.join(outDir, `JARVIS-${require(path.join(root, 'package.json')).version}-android.apk`);

function findJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Microsoft\\jdk-21.0.11.10-hotspot',
    'C:\\Program Files\\Microsoft\\jdk-21',
    'C:\\Program Files\\Microsoft\\jdk-17.0.19.10-hotspot',
    'C:\\Program Files\\Microsoft\\jdk-17',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
  ].filter(Boolean);

  for (const c of candidates) {
    const javaExe = path.join(c, 'bin', 'java.exe');
    if (!fs.existsSync(javaExe)) {
      continue;
    }
    const version = spawnSync(javaExe, ['-version'], { encoding: 'utf8' });
    const text = `${version.stderr ?? ''}${version.stdout ?? ''}`;
    const match = text.match(/version "(\d+)/);
    if (match && Number(match[1]) >= 21) {
      return c;
    }
  }

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'bin', 'java.exe'))) {
      return c;
    }
  }
  return null;
}

function findAndroidSdk() {
  const local = process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const sdkmanager = path.join(local, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  if (fs.existsSync(sdkmanager)) {
    process.env.ANDROID_HOME = local;
    process.env.ANDROID_SDK_ROOT = local;
    return local;
  }
  if (fs.existsSync(path.join(local, 'platform-tools'))) {
    process.env.ANDROID_HOME = local;
    return local;
  }
  return null;
}

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npxCmd() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function run(cmd, args, cwd, env = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

let sdk = findAndroidSdk();
if (!sdk) {
  console.log('Android SDK not found — installing command-line tools (no Android Studio)...\n');
  run('node', [path.join(__dirname, 'setup-android-sdk.js')], root);
  sdk = findAndroidSdk();
}

const javaHome = findJavaHome();
if (!javaHome) {
  console.error('Java 21+ required. Run: winget install Microsoft.OpenJDK.21');
  process.exit(1);
}

console.log(`Android SDK: ${sdk}`);
console.log(`Java: ${javaHome}`);

const gradleEnv = {
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
};

run('npm', ['run', 'build:mobile'], frontend, gradleEnv);

if (!fs.existsSync(androidDir)) {
  run('npx', ['cap', 'add', 'android'], frontend, gradleEnv);
}

run('npx', ['cap', 'sync', 'android'], frontend, gradleEnv);

const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (process.platform === 'win32') {
  run('cmd.exe', ['/c', `"${gradlew}"`, 'assembleDebug'], androidDir, gradleEnv);
} else {
  run(gradlew, ['assembleDebug'], androidDir, gradleEnv);
}

if (!fs.existsSync(releaseApk)) {
  console.error('APK not found at', releaseApk);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(releaseApk, outApk);
console.log(`\nAPK ready: ${outApk}`);
console.log('\nInstall on your phone:');
console.log('  1. Copy the APK to your Android phone (USB, Google Drive, etc.)');
console.log('  2. Open the file on your phone');
console.log('  3. Allow "Install unknown apps" if prompted');
console.log('  4. Add GROQ_API_KEY on Vercel/backend for chat to work online\n');
