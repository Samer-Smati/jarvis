import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.JARVIS_TEST_URL ?? `http://127.0.0.1:${process.env.JARVIS_PORT ?? 3847}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-android', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-iphone', use: { ...devices['iPhone 14 Pro'] } },
  ],
});
