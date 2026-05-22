import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

type Position = { x: number; y: number; z?: number };

async function login(page: Page, baseUrl: string, username: string, password: string) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 });
}

async function createLiveBattle(host: Page, guest: Page, baseUrl: string) {
  const createRes = await host.request.post(`${baseUrl}/api/game/create`, {
    data: { mode: 'collision-test' },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  const gameId = String(created._id);

  const joinRes = await guest.request.post(`${baseUrl}/api/game/join/${gameId}`);
  expect(joinRes.ok()).toBeTruthy();

  const startRes = await host.request.post(`${baseUrl}/api/game/start`, {
    data: { gameId },
  });
  expect(startRes.ok()).toBeTruthy();

  return gameId;
}

async function getSelfPosition(page: Page, baseUrl: string, gameId: string, username: string): Promise<Position> {
  const res = await page.request.get(`${baseUrl}/api/game/${gameId}`);
  expect(res.ok()).toBeTruthy();
  const game = await res.json();
  const playerNames = game.playerNames ?? {};
  const player = game.state.players.find((candidate: any) => playerNames[candidate.userId] === username);
  expect(player, `Expected ${username} in game ${gameId}`).toBeTruthy();
  return player.position;
}

function planarDistance(a: Position, b: Position) {
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
}

async function waitForBattleCanvas(page: Page, baseUrl: string, gameId: string) {
  await page.goto(`${baseUrl}/game/in-game?gameId=${gameId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

async function dispatchMovementKey(page: Page, type: 'keydown' | 'keyup', key: string) {
  await page.evaluate(({ type, key }) => {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    window.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }));
  }, { type, key });
}

async function walkAndExpectServerPositionChange(page: Page, baseUrl: string, gameId: string, username: string, label: string, holdMs = 1_400) {
  const before = await getSelfPosition(page, baseUrl, gameId, username);
  await dispatchMovementKey(page, 'keydown', 'w');
  await page.waitForTimeout(holdMs);
  await dispatchMovementKey(page, 'keyup', 'w');

  await expect.poll(async () => {
    const after = await getSelfPosition(page, baseUrl, gameId, username);
    return planarDistance(before, after);
  }, {
    message: `${label}: backend position should change after client movement input`,
    timeout: 6_000,
    intervals: [250, 500, 750],
  }).toBeGreaterThan(0.15);
}

async function primeBackendMovementSequence(page: Page, gameId: string) {
  const startedAt = Date.now() - 1_000;
  const result = await page.evaluate(async ({ gameId, startedAt }) => {
    const res = await fetch('/api/game/movement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        gameId,
        seq: 10_000,
        movementClientSessionId: `refresh-test-prime-${startedAt}`,
        movementClientStartedAt: startedAt,
        facing: { x: 0, y: 1 },
        direction: { dx: 0, dy: 0, jump: false },
      }),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  }, { gameId, startedAt });

  expect(result.ok, `prime movement sequence status=${result.status}`).toBeTruthy();
  expect(result.body?.accepted, 'prime movement sequence should be accepted').toBe(true);
}

async function attachConnectionChecklist(testInfo: TestInfo, name: string, page: Page) {
  const checklist = await page.evaluate(() => (window as any).__zhenchuanConnectionChecklist ?? null).catch((error) => ({ error: String(error) }));
  await testInfo.attach(name, {
    body: JSON.stringify(checklist, null, 2),
    contentType: 'application/json',
  });
}

test.describe('live refresh reconnect checklist', () => {
  test.skip(!primaryUsername || !primaryPassword, 'Requires ZHENCHUAN_TEST_USERNAME and ZHENCHUAN_TEST_PASSWORD');

  test('primary live account reaches the lobby', async ({ page }, testInfo) => {
    const baseUrl = (testInfo.project.use.baseURL as string | undefined) ?? 'https://zhenchuan.renstoolbox.com';
    await login(page, baseUrl, primaryUsername!, primaryPassword!);
    await expect(page).toHaveURL(`${baseUrl}/`);
  });

  test('movement still reaches backend after refreshing the in-game page', async ({ browser }, testInfo) => {
    test.skip(!secondUsername || !secondPassword, 'Requires ZHENCHUAN_SECOND_TEST_USERNAME and ZHENCHUAN_SECOND_TEST_PASSWORD for a real two-player battle');
    test.setTimeout(180_000);
    const baseUrl = (testInfo.project.use.baseURL as string | undefined) ?? 'https://zhenchuan.renstoolbox.com';
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    let gameId: string | null = null;
    let completedCleanly = false;

    try {
      await login(host, baseUrl, primaryUsername!, primaryPassword!);
      await login(guest, baseUrl, secondUsername!, secondPassword!);
      gameId = await createLiveBattle(host, guest, baseUrl);

      await Promise.all([
        waitForBattleCanvas(host, baseUrl, gameId),
        waitForBattleCanvas(guest, baseUrl, gameId),
      ]);

      await walkAndExpectServerPositionChange(host, baseUrl, gameId, primaryUsername!, 'initial connection', 3_200);
      await attachConnectionChecklist(testInfo, 'initial-connection-checklist.json', host);
      await primeBackendMovementSequence(host, gameId);

      await host.reload({ waitUntil: 'domcontentloaded' });
      await expect(host.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      await attachConnectionChecklist(testInfo, 'after-refresh-checklist.json', host);

      try {
        await walkAndExpectServerPositionChange(host, baseUrl, gameId, primaryUsername!, 'after refresh reconnect');
        completedCleanly = true;
      } catch (error) {
        await attachConnectionChecklist(testInfo, 'after-refresh-failure-checklist.json', host);
        throw error;
      }
    } finally {
      if (completedCleanly) {
        await host.evaluate(() => {
          (window as any).__zhenchuanCrashRecorder?.endSession?.('playwright-refresh-reconnect-cleanup', { clearUploadedLogs: true });
        }).catch(() => undefined);
      }
      if (gameId) {
        await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId } }).catch(() => undefined);
      }
      await hostContext.close();
      await guestContext.close();
    }
  });
});