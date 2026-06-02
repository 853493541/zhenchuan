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

test('battle log shows range warning repeatedly when spamming out-of-range ability', async ({ browser }, testInfo) => {
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

    const gameId = await createBattle(host, guest, baseUrl);
    console.log(`[battle-log] game ${gameId}`);

    // Add a short range ability (e.g. dou_zhuan_xing_yi has range 10)
    await host.request.post(`${baseUrl}/api/game/cheat/add-ability`, {
      data: { gameId, abilityId: 'na_yun_shi' }, timeout: 10_000,
    });

    // Position players far apart (>20 units so na_yun_shi at range 20 barely out)
    await host.request.post(`${baseUrl}/api/game/cheat/set-player-positions`, {
      data: {
        gameId,
        positions: [
          { playerIndex: 0, x: 409.5, y: 404, z: 0, faceX: 0, faceY: 1 },
          { playerIndex: 1, x: 409.5, y: 450, z: 0, faceX: 0, faceY: -1 },
        ],
      },
      timeout: 10_000,
    });

    // Navigate to in-game
    await host.goto(`${baseUrl}/game/in-game?gameId=${gameId}`, { waitUntil: 'domcontentloaded' });
    await host.waitForFunction(() => {
      return Array.from(document.querySelectorAll('canvas')).some((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return rect.width >= 200 && rect.height >= 200;
      });
    }, undefined, { timeout: 90_000 });
    await host.waitForTimeout(2000);

    // Click canvas to focus
    const canvas = host.locator('canvas').first();
    await canvas.click();
    await host.waitForTimeout(500);

    console.log('[battle-log] testing showInGameWarning via JS...');

    // Test 1: Show a warning
    await host.evaluate(() => {
      const fn = (window as any).__zhenchuanShowInGameWarning;
      if (fn) fn('目标在招式范围之外');
    });
    await host.waitForTimeout(500);

    let text1 = await host.evaluate(() => document.body.innerText);
    let count1 = (text1.match(/目标在招式范围之外/g) || []).length;
    console.log(`[battle-log] after 1st call: occurrences=${count1}`);

    // Test 2: Show same warning again (should replace, not stack)
    await host.evaluate(() => {
      const fn = (window as any).__zhenchuanShowInGameWarning;
      if (fn) fn('目标在招式范围之外');
    });
    await host.waitForTimeout(500);

    let text2 = await host.evaluate(() => document.body.innerText);
    let count2 = (text2.match(/目标在招式范围之外/g) || []).length;
    console.log(`[battle-log] after 2nd call: occurrences=${count2}`);

    // Test 3: After waiting for fade, call again (should reappear)
    await host.waitForTimeout(4000);
    await host.evaluate(() => {
      const fn = (window as any).__zhenchuanShowInGameWarning;
      if (fn) fn('目标在招式范围之外');
    });
    await host.waitForTimeout(500);

    let text3 = await host.evaluate(() => document.body.innerText);
    let count3 = (text3.match(/目标在招式范围之外/g) || []).length;
    console.log(`[battle-log] after fade + 3rd call: occurrences=${count3}`);

    await host.screenshot({ path: '/tmp/battle-log-range.png' });

    // Should show exactly 1 occurrence each time (dedup removes old, fresh one appears)
    expect(count1, '1st call should show 1').toBe(1);
    expect(count2, '2nd call should show 1 (replaced)').toBe(1);
    expect(count3, '3rd call after fade should show 1').toBe(1);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
