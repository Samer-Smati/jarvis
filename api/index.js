/** @type {import('@vercel/node').VercelRequest} */
/** @type {import('@vercel/node').VercelResponse} */

const path = require('path');
const Module = require('module');

const backendRoot = path.join(__dirname, '..', 'backend');
const backendModules = path.join(backendRoot, 'node_modules');

if (!process.env.NODE_PATH?.includes(backendModules)) {
  process.env.NODE_PATH = [backendModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}

let handler;

module.exports = async (req, res) => {
  try {
    if (!handler) {
      const mod = require(path.join(backendRoot, 'dist', 'serverless'));
      handler = mod.default ?? mod;
      if (typeof handler !== 'function') {
        throw new Error('serverless handler export missing');
      }
    }
    return await handler(req, res);
  } catch (error) {
    console.error('[jarvis] api bootstrap failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
