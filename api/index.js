/** @type {import('@vercel/node').VercelRequest} */
/** @type {import('@vercel/node').VercelResponse} */

let handler;

module.exports = async (req, res) => {
  try {
    if (!handler) {
      const mod = require('../backend/dist/serverless');
      handler = mod.default ?? mod;
      if (typeof handler !== 'function') {
        throw new Error('serverless handler export missing');
      }
    }
    return handler(req, res);
  } catch (error) {
    console.error('[jarvis] api bootstrap failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
