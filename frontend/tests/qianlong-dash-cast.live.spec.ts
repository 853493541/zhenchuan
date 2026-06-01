import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

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
  const createRes = await host.request.post(`${baseUrl}/api/game/create`, { data: { mode: 'yumenguan-classic' } });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  const gameId = String(created._id);
  await guest.request.post(`${baseUrl}/api/game/join/${gameId}`);
  await host.request.post(`${baseUrl}/api/game/start`, { data: { gameId } });
  return gameId;
}

async function getAbilityInstanceId(page: Page, baseUrl: string, gameId: string, abilityId: string) {
  const res = await page.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 15_000 });
  const snap = await res.json();
  const hostPlayer = snap?.state?.players?.[0];
  const ability = hostPlayer.hand.find((e: any) => (e.abilityId ?? e.id) === abilityId);
  expect(ability?.instanceId, `host should have ${abilityId} in hand`).toBeTruthy();
  return String(ability.instanceId);
}

test('qian_long_wu_yong can be cast during a dash (allowWhileDashing)', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const baseUrl = getLiveBaseUrl(testInfo);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let gameId: string | null = null;

  try {
    const hostCreds = await getOrCreateCredentials(host, baseUrl, 'host');
    const guestCreds = await getOrCreateCredentials(guest, baseUrl, 'guest');
    await login(host, baseUrl, hostCreds.username, hostCreds.password);
    await login(guest, baseUrl, guestCreds.username, guestCreds.password);
    console.log('[qianlong] logged in');

    gameId = await createBattle(host, guest, baseUrl);
    console.log(`[qianlong] game ${gameId}`);

    // Enable short cooldowns + add abilities + full heal
    await host.request.post(`${baseUrl}/api/game/cheat/yumen/test-short-cooldown`, {
      data: { gameId, enabled: true }, timeout: 10_000,
    });
    await host.request.post(`${baseUrl}/api/game/cheat/add-ability`, {
      data: { gameId, abilityId: 'nieyun_zhuyue' }, timeout: 10_000,
    });
    await host.request.post(`${baseUrl}/api/game/cheat/add-ability`, {
      data: { gameId, abilityId: 'qian_long_wu_yong' }, timeout: 10_000,
    });
    await host.request.post(`${baseUrl}/api/game/cheat/full-heal`, {
      data: { gameId }, timeout: 10_000,
    });

    // Position players close together so dash doesn't hit anything unexpected
    await host.request.post(`${baseUrl}/api/game/cheat/set-player-positions`, {
      data: {
        gameId,
        positions: [
          { playerIndex: 0, x: 409.5, y: 414, z: 0, faceX: 0, faceY: -1 },
          { playerIndex: 1, x: 409.5, y: 430, z: 0, faceX: 0, faceY: 1 },
        ],
      },
      timeout: 10_000,
    });

    const dashId = await getAbilityInstanceId(host, baseUrl, gameId, 'nieyun_zhuyue');
    const qianlongId = await getAbilityInstanceId(host, baseUrl, gameId, 'qian_long_wu_yong');

    // Test 1: Cast during standstill (no dash) → should succeed
    await host.request.post(`${baseUrl}/api/game/cheat/reset-cooldowns`, {
      data: { gameId }, timeout: 10_000,
    });
    const standaloneRes = await host.request.post(`${baseUrl}/api/game/play`, {
      data: { gameId, abilityInstanceId: qianlongId, movementIntent: false },
      timeout: 10_000,
    });
    expect(standaloneRes.ok(), `standstill cast: status=${standaloneRes.status()} body=${await standaloneRes.text().catch(()=>'')}`).toBeTruthy();
    console.log('[qianlong] standalone cast OK');

    // Wait for cooldown
    await host.waitForTimeout(2_000);
    await host.request.post(`${baseUrl}/api/game/cheat/reset-cooldowns`, {
      data: { gameId }, timeout: 10_000,
    });

    // Test 2: Cast nieyun_zhuyue to start dash, then immediately cast qian_long_wu_yong
    const dashRes = await host.request.post(`${baseUrl}/api/game/play`, {
      data: { gameId, abilityInstanceId: dashId, movementIntent: false },
      timeout: 10_000,
    });
    expect(dashRes.ok(), `dash cast: status=${dashRes.status()}`).toBeTruthy();
    console.log('[qianlong] dash started');

    // Tiny wait — dash is still active (DISPLACEMENT buff applied)
    await host.waitForTimeout(80);

    // Cast qian_long_wu_yong while dashing
    const dashCastRes = await host.request.post(`${baseUrl}/api/game/play`, {
      data: { gameId, abilityInstanceId: qianlongId, movementIntent: false },
      timeout: 10_000,
    });
    const dashCastBody = await dashCastRes.text();
    console.log(`[qianlong] dash-cast: status=${dashCastRes.status()}`);

    // Should succeed — allowWhileDashing allows casting during displacement
    expect(dashCastRes.ok(), `dash-cast should succeed (allowWhileDashing): status=${dashCastRes.status()} body=${dashCastBody.slice(0, 200)}`).toBeTruthy();

    await testInfo.attach('qianlong-results.json', {
      body: JSON.stringify({ standaloneCastOk: true, dashCastOk: dashCastRes.ok() }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    if (gameId) await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId } }).catch(() => undefined);
    await hostContext.close();
    await guestContext.close();
  }
});
