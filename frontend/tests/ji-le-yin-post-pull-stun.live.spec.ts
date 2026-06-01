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

test('ji_le_yin stun applied after pull completes, not on cast', async ({ browser }, testInfo) => {
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

    gameId = await createBattle(host, guest, baseUrl);
    console.log(`[ji_le_yin] game ${gameId}`);

    await host.request.post(`${baseUrl}/api/game/cheat/yumen/test-short-cooldown`, {
      data: { gameId, enabled: true }, timeout: 10_000,
    });

    // Place players within 10-unit range (unitScale=1 in yumenguan-classic)
    await host.request.post(`${baseUrl}/api/game/cheat/set-player-positions`, {
      data: {
        gameId,
        positions: [
          { playerIndex: 0, x: 409.5, y: 410, z: 0, faceX: 0, faceY: 1 },
          { playerIndex: 1, x: 409.5, y: 418, z: 0, faceX: 0, faceY: -1 },
        ],
      },
      timeout: 10_000,
    });

    await host.request.post(`${baseUrl}/api/game/cheat/add-ability`, {
      data: { gameId, abilityId: 'ji_le_yin' }, timeout: 10_000,
    });

    await host.request.post(`${baseUrl}/api/game/cheat/full-heal`, {
      data: { gameId }, timeout: 10_000,
    });

    // Get instanceId
    const snapRes = await host.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 15_000 });
    const snap = await snapRes.json();
    const hostPlayer = snap?.state?.players?.[0];
    const ability = hostPlayer.hand.find((e: any) => (e.abilityId ?? e.id) === 'ji_le_yin');
    expect(ability?.instanceId).toBeTruthy();
    const instanceId = String(ability.instanceId);

    // Cast ji_le_yin
    const castRes = await host.request.post(`${baseUrl}/api/game/play`, {
      data: { gameId, abilityInstanceId: instanceId, movementIntent: false },
      timeout: 10_000,
    });
    expect(castRes.ok(), `cast ji_le_yin: ${await castRes.text()}`).toBeTruthy();

    // Wait for pull + stun to settle (pull takes ticksNeeded * 33ms + some buffer)
    await host.waitForTimeout(2_000);

    // Verify guest has stun buff 2608
    const finalRes = await host.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 15_000 });
    const finalSnap = await finalRes.json();
    const guestPlayer = finalSnap?.state?.players?.[1];
    const guestBuffs = Array.isArray(guestPlayer?.buffs) ? guestPlayer.buffs : [];

    const stunBuff = guestBuffs.find((b: any) => b.buffId === 2608 && (b.expiresAt ?? 0) > Date.now());
    expect(stunBuff, 'guest should have 极乐引 stun buff (2608) after pull completes').toBeTruthy();
    expect(stunBuff.name).toContain('极乐引');

    // Verify the stun buff was NOT applied at cast time (its appliedAt should be AFTER cast)
    const events = Array.isArray(finalSnap?.state?.events) ? finalSnap.state.events : [];
    const castEvent = events.find((e: any) => e.type === 'PLAY_ABILITY' && e.abilityId === 'ji_le_yin');
    const buffEvent = events.find((e: any) => e.type === 'BUFF_APPLIED' && e.abilityId === 'ji_le_yin');
    console.log(`[ji_le_yin] cast timestamp: ${castEvent?.timestamp}, buff applied timestamp: ${buffEvent?.timestamp}`);
    if (castEvent && buffEvent) {
      expect(buffEvent.timestamp, 'stun buff should be applied after cast, not at cast time')
        .toBeGreaterThan(castEvent.timestamp + 200); // pull takes at least a few ticks
    }

    await testInfo.attach('ji_le_yin-result.json', {
      body: JSON.stringify({
        stunBuff: stunBuff ? { buffId: stunBuff.buffId, name: stunBuff.name, expiresAt: stunBuff.expiresAt } : null,
        castTimestamp: castEvent?.timestamp,
        buffTimestamp: buffEvent?.timestamp,
      }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    if (gameId) await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId } }).catch(() => undefined);
    await hostContext.close();
    await guestContext.close();
  }
});
