/** Waits for JARVIS backend /api/status before the frontend starts. */
const http = require('http');

const URL = process.env.JARVIS_BACKEND_URL ?? 'http://localhost:3000/api/status';
const MAX_MS = Number(process.env.JARVIS_WAIT_MS ?? 120000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ping() {
  return new Promise((resolve, reject) => {
    const req = http.get(URL, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function main() {
  const started = Date.now();
  process.stdout.write('[jarvis] Waiting for backend');
  while (Date.now() - started < MAX_MS) {
    try {
      if (await ping()) {
        console.log(' — online.');
        process.exit(0);
      }
    } catch {
      /* retry */
    }
    process.stdout.write('.');
    await sleep(1500);
  }
  console.warn('\n[jarvis] Backend not ready yet — starting frontend anyway.');
  process.exit(0);
}

main();
