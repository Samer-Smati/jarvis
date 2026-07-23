/** @type {import('@vercel/node').VercelRequest} */
/** @type {import('@vercel/node').VercelResponse} */

const fs = require('fs');
const path = require('path');
const Module = require('module');

function resolveBackendRoot() {
  const candidates = [
    path.join(process.cwd(), 'backend'),
    path.join(__dirname, '..', 'backend'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'dist', 'serverless.js'))) {
      return dir;
    }
  }
  return candidates[0];
}

const backendRoot = resolveBackendRoot();
process.env.JARVIS_BACKEND_ROOT = backendRoot;
const backendModules = path.join(backendRoot, 'node_modules');

try {
  require(path.join(backendModules, 'pg'));
} catch (error) {
  console.warn('[jarvis] pg preload failed:', error instanceof Error ? error.message : error);
}

if (!process.env.NODE_PATH?.includes(backendModules)) {
  process.env.NODE_PATH = [backendModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}

let nestHandler;

async function loadNestHandler() {
  if (nestHandler) {
    return nestHandler;
  }
  const mod = require(path.join(backendRoot, 'dist', 'serverless'));
  nestHandler = mod.default ?? mod;
  if (typeof nestHandler !== 'function') {
    throw new Error('serverless handler export missing');
  }
  return nestHandler;
}

module.exports = async (req, res) => {
  const url = req.url ?? '/';

  if (url.includes('/health') && req.method === 'GET') {
    res.status(200).json({ ok: true, uptime: process.uptime(), mode: 'vercel-lite' });
    return;
  }

  try {
    const handler = await loadNestHandler();
    await handler(req, res);
  } catch (error) {
    console.error('[jarvis] api bootstrap failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
