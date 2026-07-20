/**
 * Mobile/PWA frontend performance probe (simulates phone browser).
 */
const https = require('https');

const BASE = (process.env.JARVIS_REMOTE_URL ?? 'https://frontend-pearl-omega-53.vercel.app').replace(/\/$/, '');
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    https
      .get(url, { headers: { 'User-Agent': MOBILE_UA, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            ms: Date.now() - started,
            bytes: body.length,
            headers: res.headers,
            body: body.toString('utf8'),
          });
        });
      })
      .on('error', (err) => resolve({ ok: false, error: err.message, ms: Date.now() - started }));
  });
}

async function main() {
  console.log(`Mobile/PWA performance probe — ${BASE}\n`);

  const index = await get(BASE + '/');
  console.log(`Index HTML: ${index.ok ? 'OK' : 'FAIL'} · ${index.ms}ms · ${Math.round((index.bytes ?? 0) / 1024)}KB`);
  const hasAppRoot = index.body?.includes('<app-root>');
  const hasViewport = index.body?.includes('viewport-fit=cover');
  const hasPwa = index.body?.includes('mobile-web-app-capable');
  console.log(`  app-root: ${hasAppRoot ? 'yes' : 'no'} · viewport: ${hasViewport ? 'yes' : 'no'} · PWA meta: ${hasPwa ? 'yes' : 'no'}`);

  const manifest = await get(BASE + '/manifest.webmanifest');
  console.log(`Manifest: ${manifest.ok ? 'OK' : 'FAIL'} · ${manifest.ms}ms · ${Math.round((manifest.bytes ?? 0) / 1024)}KB`);
  if (manifest.ok) {
    try {
      const m = JSON.parse(manifest.body);
      console.log(`  name: ${m.name ?? m.short_name} · display: ${m.display} · icons: ${m.icons?.length ?? 0}`);
    } catch {
      console.log('  (invalid JSON)');
    }
  }

  const mobileApi = await get(BASE + '/api/integrations/mobile');
  console.log(`Mobile API: ${mobileApi.ok ? 'OK' : 'FAIL'} · ${mobileApi.ms}ms`);
  if (mobileApi.ok) {
    console.log(`  ${mobileApi.body.slice(0, 120)}`);
  }

  const health = await get(BASE + '/api/health');
  console.log(`Health: ${health.ok ? 'OK' : 'FAIL'} · ${health.ms}ms · ${health.body?.slice(0, 80)}`);

  const targets = { indexMs: 8000, manifestMs: 3000, healthMs: 3000 };
  const issues = [];
  if (index.ms > targets.indexMs) issues.push(`Index slow (${index.ms}ms)`);
  if (!hasAppRoot) issues.push('Missing app-root');
  if (!hasViewport) issues.push('Missing mobile viewport');
  if (!manifest.ok) issues.push('Manifest missing');
  if (!health.ok) issues.push('Health endpoint failed');

  console.log('\n--- Mobile verdict ---');
  if (issues.length === 0) {
    console.log('PASS — Mobile shell loads fast with PWA metadata.');
  } else {
    console.log('WARN — ' + issues.join('; '));
  }
}

main();
