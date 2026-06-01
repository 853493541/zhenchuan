import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';
const ABILITY_ID = 'fenglai_wushan';
const CHANNEL_WAIT_MS = 7_000; // buffer beyond 5s channel + haste reduction

test.use({
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});

type LoginCredentials = {
  username: string;
  password: string;
};

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
  return {
    username: `${label}_${unique}`,
    password: `${label}-${unique}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

async function createTemporaryUser(page: Page, baseUrl: string, label: string): Promise<LoginCredentials> {
  const credentials = makeTemporaryCredentials(label);
  const res = await page.request.post(`${baseUrl}/api/auth/bootstrap`, {
    data: credentials,
  });
  expect(res.ok(), `bootstrap ${label} user: ${await res.text().catch(() => '')}`).toBeTruthy();
  return credentials;
}

async function getOrCreateCredentials(page: Page, baseUrl: string, role: 'host' | 'guest'): Promise<LoginCredentials> {
  if (role === 'host' && primaryUsername && primaryPassword) {
    return { username: primaryUsername, password: primaryPassword };
  }
  if (role === 'guest' && secondUsername && secondPassword) {
    return { username: secondUsername, password: secondPassword };
  }
  return createTemporaryUser(page, baseUrl, role);
}

async function createTestBattle(host: Page, guest: Page, baseUrl: string) {
  const createRes = await host.request.post(`${baseUrl}/api/game/create`, {
    data: { mode: 'yumenguan-classic' },
  });
  expect(createRes.ok(), `create game: ${await createRes.text().catch(() => '')}`).toBeTruthy();
  const created = await createRes.json();
  const gameId = String(created._id);

  const joinRes = await guest.request.post(`${baseUrl}/api/game/join/${gameId}`);
  expect(joinRes.ok(), `join game: ${await joinRes.text().catch(() => '')}`).toBeTruthy();

  const startRes = await host.request.post(`${baseUrl}/api/game/start`, {
    data: { gameId },
  });
  expect(startRes.ok(), `start game: ${await startRes.text().catch(() => '')}`).toBeTruthy();

  return gameId;
}

async function enableShortCooldown(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/yumen/test-short-cooldown`, {
    data: { gameId, enabled: true },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `short cooldown: status=${res.status()} body=${bodyText}`).toBeTruthy();
}

async function addAbilityToHand(page: Page, baseUrl: string, gameId: string, abilityId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/add-ability`, {
    data: { gameId, abilityId },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `add ability ${abilityId}: status=${res.status()} body=${bodyText}`).toBeTruthy();
}

async function setPlayerPositions(page: Page, baseUrl: string, gameId: string) {
  // Place both players next to each other so AOE hits
  const res = await page.request.post(`${baseUrl}/api/game/cheat/set-player-positions`, {
    data: {
      gameId,
      positions: [
        { playerIndex: 0, x: 409.5, y: 414, z: 0, faceX: 0, faceY: 1 },
        { playerIndex: 1, x: 409.5, y: 418, z: 0, faceX: 0, faceY: -1 },
      ],
    },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `set positions: status=${res.status()} body=${bodyText}`).toBeTruthy();
}

async function getAbilityInstanceId(page: Page, baseUrl: string, gameId: string, abilityId: string) {
  const res = await page.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 15_000 });
  const bodyText = await res.text();
  expect(res.ok(), `snapshot: status=${res.status()} body=${bodyText.slice(0, 500)}`).toBeTruthy();
  const snapshot = JSON.parse(bodyText);
  const hostPlayer = snapshot?.state?.players?.[0];
  const ability = Array.isArray(hostPlayer?.hand)
    ? hostPlayer.hand.find((entry: any) =>
        (entry.abilityId ?? entry.id) === abilityId || entry.instanceId === abilityId,
      )
    : null;
  expect(ability?.instanceId, `host player should have ${abilityId} in hand`).toBeTruthy();
  return String(ability.instanceId);
}

async function castAbility(page: Page, baseUrl: string, gameId: string, abilityInstanceId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/play`, {
    data: { gameId, abilityInstanceId, movementIntent: false },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `cast ${abilityInstanceId}: status=${res.status()} body=${bodyText.slice(0, 300)}`).toBeTruthy();
}

async function fetchSnapshot(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 15_000 });
  const bodyText = await res.text();
  expect(res.ok(), `fetch snapshot: status=${res.status()}`).toBeTruthy();
  return JSON.parse(bodyText);
}

test.describe('fenglai_wushan haste ticks', () => {
  test('fenglai_wushan deals exactly 8 CHANNEL_AOE_TICK damage events', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);

    const baseUrl = getLiveBaseUrl(testInfo);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    let gameId: string | null = null;

    try {
      const hostCredentials = await getOrCreateCredentials(host, baseUrl, 'host');
      const guestCredentials = await getOrCreateCredentials(guest, baseUrl, 'guest');
      await login(host, baseUrl, hostCredentials.username, hostCredentials.password);
      await login(guest, baseUrl, guestCredentials.username, guestCredentials.password);
      console.log('[fenglai-wushan] logged in both test users');

      gameId = await createTestBattle(host, guest, baseUrl);
      console.log(`[fenglai-wushan] created test game ${gameId}`);

      await enableShortCooldown(host, baseUrl, gameId);
      console.log('[fenglai-wushan] short cooldown enabled');

      await setPlayerPositions(host, baseUrl, gameId);
      console.log('[fenglai-wushan] players positioned');

      await addAbilityToHand(host, baseUrl, gameId, ABILITY_ID);
      console.log('[fenglai-wushan] fenglai_wushan added to hand');

      const instanceId = await getAbilityInstanceId(host, baseUrl, gameId, ABILITY_ID);
      console.log(`[fenglai-wushan] fenglai_wushan instanceId=${instanceId}`);

      // Full heal both players before test
      await host.request.post(`${baseUrl}/api/game/cheat/full-heal`, {
        data: { gameId },
        timeout: 10_000,
      });

      await castAbility(host, baseUrl, gameId, instanceId);
      console.log('[fenglai-wushan] cast fenglai_wushan');

      // Wait for channel to complete (5s normally, reduced by haste)
      await host.waitForTimeout(CHANNEL_WAIT_MS);

      const snapshot = await fetchSnapshot(host, baseUrl, gameId);
      const events = Array.isArray(snapshot?.state?.events) ? snapshot.state.events : [];

      const tickEvents = events.filter(
        (evt: any) =>
          evt.type === 'DAMAGE' &&
          evt.abilityId === ABILITY_ID &&
          evt.effectType === 'CHANNEL_AOE_TICK',
      );

      console.log(`[fenglai-wushan] found ${tickEvents.length} CHANNEL_AOE_TICK damage events`);
      for (const evt of tickEvents) {
        console.log(`  tick ${evt.timestamp ?? '-'}: value=${evt.value}, targetUserId=${evt.targetUserId}`);
      }

      await testInfo.attach('fenglai-wushan-events.json', {
        body: JSON.stringify({ tickCount: tickEvents.length, tickEvents, totalEvents: events.length }, null, 2),
        contentType: 'application/json',
      });

      expect(
        tickEvents.length,
        `fenglai_wushan should deal 8 CHANNEL_AOE_TICK damage hits, got ${tickEvents.length}`,
      ).toBe(8);
    } finally {
      if (gameId) {
        await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId } }).catch(() => undefined);
      }
      await hostContext.close();
      await guestContext.close();
    }
  });
});
