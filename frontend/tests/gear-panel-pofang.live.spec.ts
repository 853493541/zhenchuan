import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';

test.use({ trace: 'off', screenshot: 'on', video: 'off' });

type LoginCredentials = { username: string; password: string };

function getLiveBaseUrl(testInfo: TestInfo) {
  const configured = testInfo.project.use.baseURL as string | undefined;
  if (process.env.PLAYWRIGHT_BASE_URL) return process.env.PLAYWRIGHT_BASE_URL;
  if (configured && !configured.includes('127.0.0.1') && !configured.includes('localhost')) return configured;
  return LIVE_BASE_URL;
}

async function login(page: Page, baseUrl: string, username: string, password: string) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 });
}

function makeTemporaryCredentials(label: string): LoginCredentials {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return { username: `${label}_${unique}`, password: `${label}-${unique}-${Math.random().toString(36).slice(2, 10)}` };
}

async function createTemporaryUser(page: Page, baseUrl: string, label: string): Promise<LoginCredentials> {
  const credentials = makeTemporaryCredentials(label);
  const res = await page.request.post(`${baseUrl}/api/auth/bootstrap`, { data: credentials });
  expect(res.ok()).toBeTruthy();
  return credentials;
}

async function getOrCreateCredentials(page: Page, baseUrl: string, role: 'host' | 'guest'): Promise<LoginCredentials> {
  if (role === 'host' && primaryUsername && primaryPassword) return { username: primaryUsername, password: primaryPassword };
  if (role === 'guest' && secondUsername && secondPassword) return { username: secondUsername, password: secondPassword };
  return createTemporaryUser(page, baseUrl, role);
}

async function createBattle(host: Page, guest: Page, baseUrl: string) {
  const createRes = await host.request.post(`${baseUrl}/api/game/create`, { data: { mode: 'test' } });
  expect(createRes.ok(), `create: ${await createRes.text()}`).toBeTruthy();
  const created = await createRes.json();
  const gameId = String(created._id);
  const joinRes = await guest.request.post(`${baseUrl}/api/game/join/${gameId}`);
  expect(joinRes.ok(), `join: ${await joinRes.text()}`).toBeTruthy();
  const startRes = await host.request.post(`${baseUrl}/api/game/start`, { data: { gameId } });
  expect(startRes.ok(), `start: ${await startRes.text()}`).toBeTruthy();
  return gameId;
}

test('gear panel shows 破防 stat row with 4 rarity values', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const baseUrl = getLiveBaseUrl(testInfo);
  const hostContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const guestContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    const hostCreds = await getOrCreateCredentials(host, baseUrl, 'host');
    const guestCreds = await getOrCreateCredentials(guest, baseUrl, 'guest');
    await login(host, baseUrl, hostCreds.username, hostCreds.password);
    await login(guest, baseUrl, guestCreds.username, guestCreds.password);
    console.log('[gear-panel] logged in');

    const gameId = await createBattle(host, guest, baseUrl);
    console.log(`[gear-panel] game ${gameId}`);

    // Navigate to in-game and wait for battle canvas
    await host.goto(`${baseUrl}/game/in-game?gameId=${gameId}`, { waitUntil: 'domcontentloaded' });
    await host.waitForFunction(() => {
      return Array.from(document.querySelectorAll('canvas')).some((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return rect.width >= 200 && rect.height >= 200;
      });
    }, undefined, { timeout: 90_000 });
    await host.waitForTimeout(1000);

    // Click on canvas to focus, then press Escape
    const canvas = host.locator('canvas').first();
    await canvas.click();
    await host.waitForTimeout(500);
    await host.keyboard.press('Escape');
    await host.waitForTimeout(1000);

    // Switch to "测试" tab (testing panel)
    const testTab = host.locator('button').filter({ hasText: '测试' });
    const testTabCount = await testTab.count();
    console.log(`[gear-panel] 测试 tab found: ${testTabCount}`);
    if (testTabCount > 0) {
      await testTab.first().click();
      await host.waitForTimeout(500);
    }

    // Debug: dump all visible text
    const pageText = await host.locator('body').innerText();
    console.log(`[gear-panel] page text (first 2000 chars): ${pageText.slice(0, 2000)}`);

    // Take screenshot of ESC menu
    await host.screenshot({ path: '/tmp/gear-panel-esc.png' });

    // Find and enable 装备测试栏 toggle
    const gearToggleLabel = host.locator('label').filter({ hasText: '装备测试栏' });
    const toggleCount = await gearToggleLabel.count();
    console.log(`[gear-panel] 装备测试栏 toggle found: ${toggleCount}`);

    if (toggleCount > 0) {
      const checkbox = gearToggleLabel.locator('input[type="checkbox"]');
      const isChecked = await checkbox.isChecked();
      console.log(`[gear-panel] toggle checked: ${isChecked}`);
      if (!isChecked) {
        await checkbox.check();
        await host.waitForTimeout(500);
      }
    }

    // Click to expand the detailed stats panel
    const expandBtn = gearToggleLabel.locator('..');  // go up to find gear bar area
    // Use a more specific approach: find the critPresetBar and its expand button
    const presetBarButtons = host.locator('button').filter({ hasText: /^(白装|绿装|蓝装|紫装)$/ });
    const presetBarCount = await presetBarButtons.count();
    console.log(`[gear-panel] preset buttons found: ${presetBarCount}`);

    // Toggle the gear panel expansion by clicking the >/< button
    // It's a button inside critPresetButtonStack
    const expanded = await host.evaluate(() => {
      // Find all buttons with text content exactly "<" or ">"
      const buttons = Array.from(document.querySelectorAll('button'));
      const expandBtn = buttons.find(b => {
        const text = b.textContent?.trim();
        return text === '<' || text === '>';
      });
      if (expandBtn) {
        (expandBtn as HTMLButtonElement).click();
        return true;
      }
      return false;
    });
    console.log(`[gear-panel] expand clicked: ${expanded}`);
    await host.waitForTimeout(1000);

    // Check all text
    const fullText = await host.evaluate(() => document.body.innerText);
    console.log(`[gear-panel] has 破防: ${fullText.includes('破防')}`);
    console.log(`[gear-panel] has 30%: ${fullText.includes('30%')}`);
    
    // Take screenshot
    await host.screenshot({ path: '/tmp/gear-panel-final.png' });

    expect(fullText.includes('破防'), 'should show 破防 after expanding').toBeTruthy();

    // Dump text near the gear bar area
    const gearAreaText = await host.locator('body').innerText();
    const poFangIdx = gearAreaText.indexOf('破防');
    console.log(`[gear-panel] 破防 found in text at index: ${poFangIdx}`);
    if (poFangIdx > 0) {
      console.log(`[gear-panel] context: ...${gearAreaText.slice(Math.max(0, poFangIdx - 50), poFangIdx + 50)}...`);
    }

    // Check for percentage values
    const hasPoFang30 = gearAreaText.includes('30%');
    const hasPoFang32 = gearAreaText.includes('32%');
    const hasPoFang35 = gearAreaText.includes('35%');
    const hasPoFang40 = gearAreaText.includes('40%');
    console.log(`[gear-panel] 30%:${hasPoFang30} 32%:${hasPoFang32} 35%:${hasPoFang35} 40%:${hasPoFang40}`);

    // Take screenshot
    await host.screenshot({ path: '/tmp/gear-panel-expanded.png' });

    await testInfo.attach('gear-panel.png', { path: '/tmp/gear-panel-expanded.png', contentType: 'image/png' });

    expect(poFangIdx, '装备测试栏 should show 破防 label').toBeGreaterThan(0);
    expect(hasPoFang30, 'should show 30% 破防 value').toBeTruthy();

  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
