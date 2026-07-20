/**
 * Desktop remote-mode boot simulation (no Electron): measures cloud connect time vs local backend spawn.
 */
const https = require('https');
const http = require('http');

const REMOTE = (process.env.JARVIS_REMOTE_URL ?? 'https://frontend-pearl-omega-53.vercel.app').replace(/\/$/, '');
const LOCAL = `http://127.0.0.1:${process.env.JARVIS_PORT ?? 3847}`;

function probe(base) {
  const lib = base.startsWith('https') ? https : http;
  const started = Date.now();
  return new Promise((resolve) => {
    lib.get(`${base}/api/health`, { timeout: 15000 }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode === 200, ms: Date.now() - started });
    }).on('error', () => resolve({ ok: false, ms: Date.now() - started }));
  });
}

async function main() {
  console.log('Desktop boot simulation\n');

  const remoteStart = Date.now();
  const remote = await probe(REMOTE);
  const remoteBootMs = Date.now() - remoteStart;
  console.log(`Remote (Vercel): ${remote.ok ? 'online' : 'offline'} · health ${remote.ms}ms · simulated boot ~${remoteBootMs}ms`);
  console.log('  RAM saved: no local NestJS, LM Studio probe, Piper, or Whisper');

  const local = await probe(LOCAL);
  console.log(`Local backend: ${local.ok ? 'online' : 'offline'} · health ${local.ms}ms`);
  if (local.ok) {
    const diag = await new Promise((resolve) => {
      http.get(`${LOCAL}/api/diagnostics`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
    if (diag?.memoryMb) {
      console.log(`  Backend idle RSS: ${diag.memoryMb.rss}MB · heap ${diag.memoryMb.heapUsed}MB`);
    }
  }

  console.log('\n--- Desktop verdict ---');
  if (remote.ok && remote.ms < 5000) {
    console.log(`PASS — Remote desktop mode reaches cloud in ${remote.ms}ms (target <5s).`);
  } else if (remote.ok) {
    console.log(`WARN — Remote reachable but slow (${remote.ms}ms). First load may feel sluggish.`);
  } else {
    console.log('FAIL — Remote backend unreachable. Use npm run desktop:remote after Vercel deploy.');
  }
  if (local.ok && local.ms < 100) {
    console.log(`PASS — Local backend responds in ${local.ms}ms (excellent).`);
  }
}

main();
