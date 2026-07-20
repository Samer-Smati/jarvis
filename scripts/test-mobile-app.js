/**
 * Mobile app (PWA) smoke test — iPhone viewport via Playwright, not desktop browser layout.
 * Usage: node scripts/test-mobile-app.js [baseUrl]
 */
const http = require('http');

const BASE = (process.argv[2] ?? process.env.JARVIS_MOBILE_URL ?? `http://127.0.0.1:${process.env.JARVIS_PORT ?? 3847}`).replace(/\/$/, '');
const TARGET_LOAD_MS = 10000;

async function ensureServer() {
  return new Promise((resolve) => {
    http.get(`${BASE}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

async function runPlaywright() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    console.error('Playwright not installed. Run: npm install -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  const { chromium, devices } = playwright;
  const device = devices['iPhone 14 Pro'];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...device,
    locale: 'en-US',
  });
  const page = await context.newPage();

  const started = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const loadMs = Date.now() - started;

  await page.waitForSelector('app-root', { timeout: 15000 });
  const brand = await page.locator('.brand .name').first().textContent().catch(() => '');
  const hasChat = (await page.locator('textarea, input[type="text"], .chat-input').count()) > 0;
  const viewport = page.viewportSize();
  const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
  const standaloneMeta = await page.locator('meta[name="mobile-web-app-capable"]').getAttribute('content');

  await browser.close();

  return {
    loadMs,
    brand: brand?.trim() ?? '',
    hasChat,
    viewport,
    manifestLink,
    standaloneMeta,
  };
}

async function main() {
  console.log(`\n=== JARVIS Mobile App Test (PWA / iPhone) ===`);
  console.log(`URL: ${BASE}\n`);

  const up = await ensureServer();
  if (!up) {
    console.log('FAIL — App server not reachable. Start backend with UI first:');
    console.log('  npm run build --prefix frontend -- --configuration development');
    console.log('  node scripts/copy-frontend.js');
    console.log('  npm run start:prod --prefix backend');
    process.exit(1);
  }
  console.log('PASS — App server online');

  try {
    const r = await runPlaywright();
    console.log(`Page load: ${r.loadMs}ms ${r.loadMs <= TARGET_LOAD_MS ? '(PASS)' : '(WARN > ' + TARGET_LOAD_MS + 'ms)'}`);
    console.log(`Viewport: ${r.viewport?.width}x${r.viewport?.height} (mobile)`);
    console.log(`Brand: ${r.brand.includes('J.A.R.V.I.S') ? 'PASS' : 'FAIL'} — "${r.brand}"`);
    console.log(`Chat input: ${r.hasChat ? 'PASS' : 'FAIL'}`);
    console.log(`PWA manifest: ${r.manifestLink ? 'PASS' : 'FAIL'} (${r.manifestLink ?? 'missing'})`);
    console.log(`Standalone meta: ${r.standaloneMeta === 'yes' ? 'PASS' : 'FAIL'}`);

    const ok = r.brand.includes('J.A.R.V.I.S') && r.hasChat && !!r.manifestLink && r.standaloneMeta === 'yes';
    console.log(`\nMobile app smoke: ${ok ? 'PASS' : 'FAIL'}\n`);
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.error('FAIL —', (error).message);
    process.exit(1);
  }
}

main();
