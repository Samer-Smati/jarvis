import { expect, test } from '@playwright/test';

async function openNav(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: label }).click();
  await page.waitForLoadState('networkidle');
}

async function waitForSettings(page: import('@playwright/test').Page) {
  await page.goto('/settings');
  await expect(page.getByText('Neural core', { exact: false })).toBeVisible({ timeout: 30000 });
}

async function waitForDashboard(page: import('@playwright/test').Page) {
  await page.goto('/dashboard');
  await expect(page.getByText('Neural core', { exact: false })).toBeVisible({ timeout: 30000 });
}

test.describe('Human journey — full app walkthrough', () => {
  test('sidebar brand and navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.brand .name')).toHaveText('J.A.R.V.I.S');
    await expect(page.locator('.sys-status')).toContainText(/SYSTEM ONLINE|LISTENING|SPEAKING/);

    await openNav(page, 'Systems');
    await expect(page.getByText('Neural core', { exact: false })).toBeVisible({ timeout: 30000 });

    await waitForSettings(page);
    await expect(page.locator('.provider-select')).toBeVisible();

    await openNav(page, 'Interface');
    await expect(page.getByText('// Voice Interface')).toBeVisible();
  });

  test('settings dropdowns show full labels (not truncated)', async ({ page }) => {
    await waitForSettings(page);

    const provider = page.locator('.provider-select');
    await expect(provider).toBeVisible();
    const providerText = await provider.innerText();
    expect(providerText.length).toBeGreaterThan(4);
    expect(providerText).not.toMatch(/^(Ol|Pi|W)$/i);
    expect(providerText).toMatch(/Groq|LM Studio|Ollama|Claude/i);

    await provider.click();
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');

    const ttsText = await page.locator('.tts-engine-select').innerText();
    expect(ttsText).toMatch(/Piper|Browser/i);

    const sttText = await page.locator('.stt-engine-select').innerText();
    expect(sttText).toMatch(/Whisper|Browser/i);
  });

  test('settings skills and performance panels load', async ({ page }) => {
    await waitForSettings(page);
    await expect(page.getByText('Skill matrix', { exact: false })).toBeVisible();
    await expect(page.getByText('Performance', { exact: true })).toBeVisible();
    await expect(page.getByText('Device permissions', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kill switch' })).toBeVisible();
  });

  test('dashboard shows backend status', async ({ page }) => {
    await waitForDashboard(page);
    await expect(page.getByText('Provider', { exact: false })).toBeVisible();
  });

  test('chat interface accepts input and shows welcome', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('At your service, sir.')).toBeVisible({ timeout: 30000 });
    const input = page.locator('textarea');
    await expect(input).toBeVisible();
    await input.fill('Hello JARVIS');
    await expect(input).toHaveValue('Hello JARVIS');
    await input.press('Enter');

    await expect(page.locator('.message.user .content')).toContainText('Hello JARVIS', { timeout: 15000 });
  });

  test('chat gets assistant reply when cloud LLM is configured', async ({ page }) => {
    test.skip(!process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY, 'Set GROQ_API_KEY for live chat test');

    await page.goto('/');
    await page.locator('textarea').fill('Reply with exactly: JARVIS ONLINE');
    await page.locator('textarea').press('Enter');

    await expect(page.locator('.message.user')).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator('.message.assistant .content')).not.toBeEmpty({ timeout: 90000 });
  });
});

test.describe('Mobile human journey', () => {
  test('mobile layout — chat and nav usable', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile viewport only');
    await page.goto('/');
    await expect(page.locator('.brand .name')).toBeVisible();
    await expect(page.locator('textarea')).toBeVisible();
    await page.getByRole('link', { name: 'Protocols' }).click();
    await expect(page.getByText('Neural core', { exact: false })).toBeVisible({ timeout: 30000 });
    const providerText = await page.locator('.provider-select').innerText();
    expect(providerText).toMatch(/Groq|Claude/i);
  });
});
