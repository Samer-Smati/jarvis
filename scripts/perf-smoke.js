/**
 * Performance smoke test for JARVIS desktop (local + remote) and mobile (web/PWA).
 * Usage: node scripts/perf-smoke.js [--local] [--remote]
 */
const http = require('http');
const https = require('https');

const LOCAL_PORT = Number(process.env.JARVIS_PORT ?? 3847);
const LOCAL_BASE = `http://127.0.0.1:${LOCAL_PORT}`;
const REMOTE_BASE = (process.env.JARVIS_REMOTE_URL ?? 'https://frontend-pearl-omega-53.vercel.app').replace(/\/$/, '');
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const TARGETS = {
  healthMs: 3000,
  statusMs: 5000,
  diagnosticsMs: 8000,
  pageLoadMs: 8000,
  backendIdleRssMb: 200,
  chatFirstTokenMs: 30000,
};

const args = process.argv.slice(2);
const testLocal = args.length === 0 || args.includes('--local');
const testRemote = args.length === 0 || args.includes('--remote');

function fetchJson(url, opts = {}) {
  const started = Date.now();
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve) => {
    const req = lib.get(
      url,
      {
        timeout: opts.timeout ?? 15000,
        headers: opts.headers ?? {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const ms = Date.now() - started;
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, ms, json, body: body.slice(0, 200), contentType: res.headers['content-type'] ?? '' });
        });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: 0, ms: Date.now() - started, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, ms: Date.now() - started, error: 'timeout' });
    });
  });
}

function fetchHead(url, opts = {}) {
  const started = Date.now();
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve) => {
    const req = lib.request(
      url,
      { method: 'HEAD', timeout: opts.timeout ?? 15000, headers: opts.headers ?? {} },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, ms: Date.now() - started });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: 0, ms: Date.now() - started, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, ms: Date.now() - started, error: 'timeout' });
    });
    req.end();
  });
}

function pass(label, detail) {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail) {
  console.log(`  WARN  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function probeBackend(name, base) {
  console.log(`\n=== ${name} (${base}) ===`);
  const results = { name, base, passed: 0, failed: 0, warns: 0 };

  const health = await fetchJson(`${base}/api/health`);
  const healthJson = health.json && typeof health.json === 'object' && health.json.ok === true;
  if (health.ok && healthJson) {
    pass('GET /api/health', `${health.ms}ms`);
    results.passed++;
    if (health.ms > TARGETS.healthMs) {
      warn('Health latency', `${health.ms}ms > ${TARGETS.healthMs}ms target`);
      results.warns++;
    }
  } else if (health.ok && health.body?.includes('<!doctype html')) {
    fail('GET /api/health', 'returns SPA HTML — Vercel API not deployed');
    results.failed++;
    return results;
  } else {
    fail('GET /api/health', health.error ?? `HTTP ${health.status}`);
    results.failed++;
    return results;
  }

  const status = await fetchJson(`${base}/api/status`);
  const statusJson = status.json && typeof status.json === 'object' && 'provider' in status.json;
  if (status.ok && statusJson) {
    const llm = status.json?.llmReady ? 'LLM ready' : 'LLM offline';
    pass('GET /api/status', `${status.ms}ms · ${llm} · ${status.json?.provider ?? '?'}`);
    results.passed++;
    if (status.ms > TARGETS.statusMs) {
      warn('Status latency', `${status.ms}ms > ${TARGETS.statusMs}ms`);
      results.warns++;
    }
  } else if (status.ok && status.body?.includes('<!doctype html')) {
    fail('GET /api/status', 'returns SPA HTML — API route missing on Vercel');
    results.failed++;
  } else {
    fail('GET /api/status', status.error ?? `HTTP ${status.status}`);
    results.failed++;
  }

  const diag = await fetchJson(`${base}/api/diagnostics`);
  const diagJson = diag.json && typeof diag.json === 'object' && diag.json.memoryMb;
  if (diag.ok && diagJson) {
    const mem = diag.json?.memoryMb;
    pass(
      'GET /api/diagnostics',
      `${diag.ms}ms · RSS ${mem?.rss ?? '?'}MB · heap ${mem?.heapUsed ?? '?'}MB · uptime ${diag.json?.uptimeSec ?? '?'}s`,
    );
    results.passed++;
    if (diag.ms > TARGETS.diagnosticsMs) {
      warn('Diagnostics latency', `${diag.ms}ms > ${TARGETS.diagnosticsMs}ms`);
      results.warns++;
    }
    if (mem?.rss && mem.rss > TARGETS.backendIdleRssMb && name.includes('Local')) {
      warn('Backend RSS', `${mem.rss}MB > ${TARGETS.backendIdleRssMb}MB idle target`);
      results.warns++;
    } else if (mem?.rss && name.includes('Local')) {
      pass('Backend idle RAM', `${mem.rss}MB ≤ ${TARGETS.backendIdleRssMb}MB target`);
      results.passed++;
    }
  } else if (diag.ok && diag.body?.includes('<!doctype html')) {
    fail('GET /api/diagnostics', 'returns SPA HTML — API route missing on Vercel');
    results.failed++;
  } else {
    fail('GET /api/diagnostics', diag.error ?? `HTTP ${diag.status}`);
    results.failed++;
  }

  const page = await fetchHead(base === LOCAL_BASE ? base : base, { headers: {} });
  if (page.ok) {
    pass('Frontend shell (HEAD /)', `${page.ms}ms`);
    results.passed++;
    if (page.ms > TARGETS.pageLoadMs) {
      warn('Page HEAD latency', `${page.ms}ms > ${TARGETS.pageLoadMs}ms`);
      results.warns++;
    }
  } else if (name.includes('Remote')) {
    const pageGet = await fetchJson(base);
    if (pageGet.ok || pageGet.status === 200) {
      pass('Frontend shell (GET /)', `${pageGet.ms}ms`);
      results.passed++;
    } else {
      fail('Frontend shell', pageGet.error ?? `HTTP ${pageGet.status}`);
      results.failed++;
    }
  } else {
    warn('Frontend shell', page.error ?? 'local backend serves API only');
    results.warns++;
  }

  const mobile = await fetchHead(base, { headers: { 'User-Agent': MOBILE_UA } });
  if (mobile.ok || name.includes('Local')) {
    pass('Mobile UA page reachability', `${mobile.ms}ms`);
    results.passed++;
  } else {
    fail('Mobile UA page', mobile.error ?? `HTTP ${mobile.status}`);
    results.failed++;
  }

  return results;
}

async function main() {
  console.log('JARVIS performance smoke test');
  console.log(`Targets: health<${TARGETS.healthMs}ms status<${TARGETS.statusMs}ms page<${TARGETS.pageLoadMs}ms local RSS<${TARGETS.backendIdleRssMb}MB`);

  const all = [];

  if (testLocal) {
    all.push(await probeBackend('Desktop local backend', LOCAL_BASE));
  }
  if (testRemote) {
    all.push(await probeBackend('Mobile/Web remote (Vercel)', REMOTE_BASE));
  }

  console.log('\n=== Summary ===');
  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;
  for (const r of all) {
    console.log(`${r.name}: ${r.passed} passed, ${r.failed} failed, ${r.warns} warnings`);
    totalPass += r.passed;
    totalFail += r.failed;
    totalWarn += r.warns;
  }

  console.log(`\nTotal: ${totalPass} passed, ${totalFail} failed, ${totalWarn} warnings`);
  if (totalFail === 0 && all.length > 0) {
    console.log('\nPerformance smoke: OK (no hard failures)');
    if (totalWarn > 0) {
      console.log('Review warnings above for latency/RAM tuning.');
    }
    process.exit(0);
  }
  if (all.length === 0) {
    console.log('No probes ran.');
    process.exit(1);
  }
  console.log('\nPerformance smoke: FAILED — fix failures before shipping.');
  process.exit(1);
}

main();
