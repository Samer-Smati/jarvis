const { app, BrowserWindow, shell } = require('electron');

const { spawn, execSync } = require('child_process');

const path = require('path');

const http = require('http');

const fs = require('fs');



const PORT = Number(process.env.JARVIS_PORT ?? 3847);

const STARTUP_TIMEOUT_MS = 120000;

const ELECTRON_APP_NAME = 'J.A.R.V.I.S.exe';



let mainWindow;

let backendProcess;

let onSplash = false;

let splashReady = Promise.resolve();

let bootLogPath;



function rootDir() {

  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');

}



function backendRoot() {

  return path.join(rootDir(), 'backend');

}



function backendEntry() {

  return path.join(backendRoot(), 'dist', 'main.js');

}



function appVersion() {

  try {

    return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).version ?? '1.0.0';

  } catch {

    return '1.0.0';

  }

}



function splashPath() {

  return path.join(__dirname, 'splash.html');

}



function logBoot(message) {

  const line = `[${new Date().toISOString()}] ${message}`;

  console.log(line);

  if (!bootLogPath) {

    return;

  }

  try {

    fs.appendFileSync(bootLogPath, `${line}\n`, 'utf8');

  } catch {

    /* ignore log failures */

  }

}



function splashCall(expr) {

  if (!onSplash || !mainWindow?.webContents || mainWindow.isDestroyed()) {

    return Promise.resolve();

  }

  return splashReady

    .then(() => {

      if (!onSplash || !mainWindow?.webContents || mainWindow.isDestroyed()) {

        return;

      }

      return mainWindow.webContents.executeJavaScript(expr);

    })

    .catch(() => {});

}



function setStatus(text, isError = false) {

  logBoot(`status: ${text}`);

  void splashCall(`window.setStatus(${JSON.stringify(text)}, ${isError})`);

}



function addBootLine(text, ok = false) {

  void splashCall(`window.addBootLine(${JSON.stringify(text)}, ${ok})`);

}



function setProgress(pct) {

  void splashCall(`window.setProgress(${Number(pct)})`);

}



function setMetric(key, val) {

  void splashCall(`window.setMetric(${JSON.stringify(key)}, ${JSON.stringify(val)})`);

}



function findSystemNode() {

  const candidates = [];

  if (process.env.PATH) {

    for (const entry of process.env.PATH.split(path.delimiter)) {

      const trimmed = entry.trim();

      if (trimmed) {

        candidates.push(path.join(trimmed, process.platform === 'win32' ? 'node.exe' : 'node'));

      }

    }

  }

  if (process.env.ProgramFiles) {

    candidates.push(path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'));

  }

  if (process.env['ProgramFiles(x86)']) {

    candidates.push(path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe'));

  }



  for (const candidate of candidates) {

    if (candidate && fs.existsSync(candidate)) {

      return candidate;

    }

  }



  try {

    execSync('where node', { stdio: 'pipe', windowsHide: true, env: process.env });

    return 'node';

  } catch {

    return null;

  }

}



function electronRuntimePath() {

  const candidates = [

    path.join(path.dirname(process.execPath), ELECTRON_APP_NAME),

    path.join(process.resourcesPath, '..', ELECTRON_APP_NAME),

  ];



  if (!process.execPath.toLowerCase().includes('portable')) {

    candidates.unshift(process.execPath);

  }



  for (const candidate of candidates) {

    if (candidate && fs.existsSync(candidate)) {

      return candidate;

    }

  }



  return null;

}



function resolveNodeBinary() {

  if (app.isPackaged) {

    const runtime = electronRuntimePath();

    if (!runtime) {

      throw new Error('Could not find J.A.R.V.I.S runtime next to the portable app.');

    }

    return { bin: runtime, useElectronAsNode: true };

  }



  const systemNode = findSystemNode();

  if (systemNode) {

    return { bin: systemNode, useElectronAsNode: false };

  }



  return { bin: process.execPath, useElectronAsNode: true };

}



function runScriptAsync(scriptName, extraEnv = {}, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const script = path.join(rootDir(), 'scripts', scriptName);
    if (!fs.existsSync(script)) {
      logBoot(`${scriptName} missing at ${script}`);
      resolve(false);
      return;
    }
    const { bin, useElectronAsNode } = resolveNodeBinary();
    const env = { ...process.env, ...extraEnv };
    if (useElectronAsNode) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }
    logBoot(`running ${scriptName} async via ${bin}`);
    const child = spawn(bin, [script], { env, windowsHide: true, stdio: 'pipe' });
    const timer = setTimeout(() => {
      child.kill();
      logBoot(`${scriptName} timed out`);
      resolve(false);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => logBoot(`${scriptName}: ${chunk.toString().trim()}`));
    child.stderr?.on('data', (chunk) => logBoot(`${scriptName} err: ${chunk.toString().trim()}`));
    child.on('close', (code) => {
      clearTimeout(timer);
      logBoot(`${scriptName} exit ${code}`);
      resolve(code === 0);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      logBoot(`${scriptName} spawn error: ${err.message}`);
      resolve(false);
    });
  });
}

function runEnsureAi() {
  const mode = process.env.JARVIS_LLM_ENSURE ?? 'probe';
  return runScriptAsync('ensure-ai.js', { JARVIS_LLM_ENSURE: mode }, 180000);
}

function runEnsurePiper() {
  const userData = app.getPath('userData');
  const piperCache = path.join(userData, 'data', 'piper-cache');
  fs.mkdirSync(piperCache, { recursive: true });
  return runScriptAsync(
    'ensure-piper.js',
    {
      PIPER_CACHE: piperCache,
      PIPER_VOICE: process.env.PIPER_VOICE ?? 'en_GB-alan-medium',
    },
    300000,
  );
}



function startBackend() {

  const entry = backendEntry();

  if (!fs.existsSync(entry)) {

    throw new Error('Backend not built. Run: npm run build:desktop');

  }



  const userData = app.getPath('userData');

  const dataDir = path.join(userData, 'data');

  fs.mkdirSync(dataDir, { recursive: true });



  const { bin, useElectronAsNode } = resolveNodeBinary();

  logBoot(`backend spawn: ${bin} (electronAsNode=${useElectronAsNode})`);



  const env = {

    ...process.env,

    PORT: String(PORT),

    FRONTEND_PATH: path.join(backendRoot(), 'public'),

    DATABASE_PATH: path.join(dataDir, 'jarvis.sqlite'),

    FILES_ROOT: path.join(dataDir, 'files'),

    TRANSFORMERS_CACHE: path.join(dataDir, 'whisper-cache'),

    PIPER_CACHE: path.join(dataDir, 'piper-cache'),

    PIPER_VOICE: process.env.PIPER_VOICE ?? 'en_GB-alan-medium',

    JARVIS_LLM_ENSURE: process.env.JARVIS_LLM_ENSURE ?? 'probe',

    JARVIS_DEFER_PIPER: process.env.JARVIS_DEFER_PIPER ?? '1',

    JARVIS_PERFORMANCE_MODE: process.env.JARVIS_PERFORMANCE_MODE ?? '1',

    WHISPER_MODEL: process.env.WHISPER_MODEL ?? 'Xenova/whisper-tiny',

    CORS_ORIGIN: `http://127.0.0.1:${PORT}`,

  };

  if (useElectronAsNode) {

    env.ELECTRON_RUN_AS_NODE = '1';

  }



  backendProcess = spawn(bin, [entry], {

    env,

    cwd: backendRoot(),

    stdio: ['ignore', 'pipe', 'pipe'],

    windowsHide: true,

  });



  backendProcess.stdout?.on('data', (chunk) => {

    const line = chunk.toString().trim();

    logBoot(`backend: ${line}`);

    if (line.includes('J.A.R.V.I.S online') || line.includes('Nest application successfully started')) {

      addBootLine('Neural interface online', true);

    }

  });



  backendProcess.stderr?.on('data', (chunk) => {

    const line = chunk.toString().trim();

    logBoot(`backend err: ${line}`);

    if (line.includes('ERR_DLOPEN_FAILED') || line.includes('better_sqlite3')) {

      setStatus('Database module error — rebuild the desktop app.', true);

    }

  });



  backendProcess.on('exit', (code) => {

    logBoot(`backend exit: ${code}`);

    if (code && code !== 0 && mainWindow) {

      setStatus(`Backend stopped (code ${code}). Check boot.log in AppData\\jarvis.`, true);

    }

  });

}



function waitForBackendHealth(maxMs = STARTUP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
        res.resume();
      });
      req.on('error', retry);
      req.setTimeout(3000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > maxMs) {
        reject(new Error('Backend did not start in time.'));
      } else {
        setTimeout(tick, 1500);
      }
    };
    tick();
  });
}

function fetchBackendStatus() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/status`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({});
          }
        } else {
          resolve({});
        }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({});
    });
  });
}



function createSplashWindow() {

  onSplash = true;

  mainWindow = new BrowserWindow({

    width: 1360,

    height: 860,

    minWidth: 960,

    minHeight: 640,

    title: 'J.A.R.V.I.S',

    backgroundColor: '#030811',

    autoHideMenuBar: true,

    show: false,

    center: true,

    webPreferences: {

      contextIsolation: true,

      nodeIntegration: false,

    },

  });



  mainWindow.once('ready-to-show', () => {

    mainWindow.show();

    mainWindow.focus();

    logBoot('splash window visible');

  });



  splashReady = new Promise((resolve) => {

    mainWindow.webContents.once('did-finish-load', resolve);

  });



  mainWindow.loadFile(splashPath());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {

    shell.openExternal(url);

    return { action: 'deny' };

  });

}



function loadMainApp(status) {

  const model = status?.llmModel ?? status?.provider ?? 'online';

  addBootLine(`Neural core: ${model}`, true);

  addBootLine('Loading HUD interface', true);

  setMetric('neural', 'ONLINE');

  setMetric('voice', 'READY');

  setMetric('reactor', '100%');

  setProgress(100);

  setStatus('Systems online. Loading interface');

  setTimeout(() => {

    onSplash = false;

    mainWindow?.loadURL(`http://127.0.0.1:${PORT}`);

  }, 600);

}



async function bootSequence() {
  const bootStarted = Date.now();
  bootLogPath = path.join(app.getPath('userData'), 'boot.log');
  logBoot(`boot start packaged=${app.isPackaged} execPath=${process.execPath}`);

  createSplashWindow();
  await splashReady;
  void splashCall(`window.setVersion(${JSON.stringify(`MK-IV · v${appVersion()}`)})`);

  setStatus('Starting neural core');
  setProgress(20);
  addBootLine('Launching backend services');

  try {
    startBackend();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  setStatus('Waiting for neural core response');
  setProgress(45);
  setMetric('neural', 'SYNC');
  addBootLine(`Connecting to port ${PORT}`);

  const llmEnsure = process.env.JARVIS_LLM_ENSURE ?? 'probe';
  const deferPiper = process.env.JARVIS_DEFER_PIPER !== '0' && process.env.JARVIS_DEFER_PIPER !== 'false';

  const backgroundTasks = [];
  if (llmEnsure !== 'off') {
    backgroundTasks.push(
      runEnsureAi().then((ok) => addBootLine(ok ? 'AI runtime probe complete' : 'AI runtime offline', ok)),
    );
  }
  if (!deferPiper) {
    addBootLine('Voice synthesis: loading Piper model…');
    backgroundTasks.push(
      runEnsurePiper().then((ok) => addBootLine(ok ? 'Voice synthesis ready' : 'Voice synthesis deferred', ok)),
    );
  } else {
    addBootLine('Voice synthesis deferred until first use', true);
  }

  try {
    await waitForBackendHealth();
    logBoot(`backend health ok in ${Date.now() - bootStarted}ms`);
    void Promise.all(backgroundTasks);
    const status = await fetchBackendStatus();
    if (!status?.llmReady) {
      addBootLine('LM Studio offline — start LM Studio first', false);
    }
    logBoot(`boot complete in ${Date.now() - bootStarted}ms`);
    loadMainApp(status);
  } catch (error) {
    setStatus(error.message, true);
    addBootLine('Startup failed', false);
  }
}



const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {

  app.quit();

} else {

  app.on('second-instance', () => {

    if (mainWindow) {

      if (mainWindow.isMinimized()) {

        mainWindow.restore();

      }

      mainWindow.show();

      mainWindow.focus();

    }

  });



  app.whenReady().then(bootSequence);

}



app.on('window-all-closed', () => {

  if (process.platform !== 'darwin') {

    app.quit();

  }

});



app.on('before-quit', () => {

  if (backendProcess && !backendProcess.killed) {

    backendProcess.kill();

  }

});


