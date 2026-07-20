/**
 * Install Android SDK command-line tools (no Android Studio required).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync } = require('child_process');

const SDK_ROOT = process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const CMD_TOOLS_URL =
  'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip';
const CMD_TOOLS_ZIP = path.join(SDK_ROOT, 'cmdline-tools.zip');
const CMD_TOOLS_DIR = path.join(SDK_ROOT, 'cmdline-tools', 'latest');

function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  const candidates = [
    'C:\\Program Files\\Microsoft\\jdk-21.0.11.10-hotspot',
    'C:\\Program Files\\Microsoft\\jdk-21',
    'C:\\Program Files\\Microsoft\\jdk-17.0.19.10-hotspot',
    'C:\\Program Files\\Microsoft\\jdk-17',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'bin', 'java.exe'))) {
      return c;
    }
  }
  try {
    const out = execSync('where java', { encoding: 'utf8' }).trim().split('\n')[0];
    if (out) {
      return path.dirname(path.dirname(out.trim()));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          file.close();
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', reject);
  });
}

function sdkReady() {
  const buildTools = path.join(SDK_ROOT, 'build-tools', '35.0.0', 'aapt2.exe');
  const platform = path.join(SDK_ROOT, 'platforms', 'android-36', 'android.jar');
  return fs.existsSync(buildTools) && fs.existsSync(platform);
}

function runSdkManager(javaHome, args) {
  const sdkmanager = path.join(CMD_TOOLS_DIR, 'bin', 'sdkmanager.bat');
  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: SDK_ROOT,
    ANDROID_SDK_ROOT: SDK_ROOT,
  };
  const input = spawnSync('cmd.exe', ['/c', `"${sdkmanager}"`, ...args], {
    env,
    input: 'y\n'.repeat(20),
    encoding: 'utf8',
    shell: false,
  });
  if (input.status !== 0) {
    console.error(input.stdout);
    console.error(input.stderr);
    throw new Error(`sdkmanager failed: ${args.join(' ')}`);
  }
  return input.stdout;
}

async function main() {
  const javaHome = findJavaHome();
  if (!javaHome) {
    console.error('Java 17+ required. Install: winget install Microsoft.OpenJDK.17');
    process.exit(1);
  }

  process.env.JAVA_HOME = javaHome;
  process.env.ANDROID_HOME = SDK_ROOT;
  process.env.ANDROID_SDK_ROOT = SDK_ROOT;
  fs.mkdirSync(SDK_ROOT, { recursive: true });

  if (!fs.existsSync(path.join(CMD_TOOLS_DIR, 'bin', 'sdkmanager.bat'))) {
    console.log('Downloading Android command-line tools...');
    await download(CMD_TOOLS_URL, CMD_TOOLS_ZIP);
    fs.mkdirSync(path.join(SDK_ROOT, 'cmdline-tools'), { recursive: true });
    const extractDir = path.join(SDK_ROOT, 'cmdline-tools', '_extract');
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${CMD_TOOLS_ZIP}' -DestinationPath '${extractDir}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    fs.rmSync(CMD_TOOLS_DIR, { recursive: true, force: true });
    const inner = path.join(extractDir, 'cmdline-tools');
    fs.renameSync(inner, CMD_TOOLS_DIR);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.unlinkSync(CMD_TOOLS_ZIP);
    console.log('Command-line tools installed.');
  }

  console.log(`SDK root: ${SDK_ROOT}`);
  console.log(`Java: ${javaHome}`);

  const packages = [
    'platform-tools',
    'platforms;android-36',
    'build-tools;35.0.0',
  ];

  for (const pkg of packages) {
    console.log(`Installing ${pkg}...`);
    try {
      runSdkManager(javaHome, [pkg]);
    } catch (err) {
      console.warn(`${err.message} — retrying once...`);
      runSdkManager(javaHome, [pkg]);
    }
  }

  if (!sdkReady()) {
    throw new Error('Android SDK install incomplete (build-tools 34.0.0 or platform 34 missing)');
  }

  console.log('Android SDK ready (no Android Studio needed).');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
