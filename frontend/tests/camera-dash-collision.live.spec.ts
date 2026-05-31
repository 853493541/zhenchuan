import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';
const REQUIRED_SUCCESS_COUNT = 10;

test.use({
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});

type LoginCredentials = {
  username: string;
  password: string;
};

type CameraDashCase = {
  label: string;
  category: 'house' | 'mountain' | 'wall';
  host: { x: number; y: number };
  guest: { x: number; y: number };
};

type CameraDashResult = CameraDashCase & {
  success: boolean;
  reason: string;
  summary: any;
  gameId: string;
};

const CAMERA_DASH_CASES: CameraDashCase[] = [
  { label: 'house west edge far', category: 'house', host: { x: 227, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'house west edge near', category: 'house', host: { x: 238, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'house east edge near', category: 'house', host: { x: 312, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'house east edge far', category: 'house', host: { x: 323, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'mountain west edge far', category: 'mountain', host: { x: 227, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'mountain west edge near', category: 'mountain', host: { x: 238, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'mountain east edge near', category: 'mountain', host: { x: 312, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'mountain east edge far', category: 'mountain', host: { x: 323, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'wall west face far', category: 'wall', host: { x: 227, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'wall west face near', category: 'wall', host: { x: 238, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'wall east face near', category: 'wall', host: { x: 312, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'wall east face far', category: 'wall', host: { x: 323, y: 426 }, guest: { x: 230, y: 426 } },
];

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
    username: `camera_${label}_${unique}`,
    password: `camera-${unique}-${Math.random().toString(36).slice(2, 10)}`,
  };
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

async function createCollisionTestBattle(host: Page, guest: Page, baseUrl: string) {
  const createRes = await host.request.post(`${baseUrl}/api/game/create`, {
    data: { mode: 'collision-test' },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  const gameId = String(created._id);

  const joinRes = await guest.request.post(`${baseUrl}/api/game/join/${gameId}`);
  expect(joinRes.ok()).toBeTruthy();

  const startRes = await host.request.post(`${baseUrl}/api/game/start`, { data: { gameId } });
  expect(startRes.ok()).toBeTruthy();
  return gameId;
}

async function waitForBattleCanvas(page: Page, baseUrl: string, gameId: string) {
  await page.goto(`${baseUrl}/game/in-game?gameId=${gameId}&playwrightCameraDashProbe=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('canvas')).some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = window.getComputedStyle(canvas);
      return rect.width >= 200 && rect.height >= 200 && style.display !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => {
    return (window as any).__zhenchuanCameraDashProbe?.last?.collisionReady === true;
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => typeof (window as any).__zhenchuanCastAbilityForProbe === 'function', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => typeof (window as any).__zhenchuanRefreshGameForProbe === 'function', undefined, { timeout: 20_000 });
}

async function getNieyunInstanceId(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 15_000 });
  const bodyText = await res.text();
  expect(res.ok(), `snapshot failed: status=${res.status()} body=${bodyText.slice(0, 1000)}`).toBeTruthy();
  const snapshot = JSON.parse(bodyText);
  const hostPlayer = snapshot?.state?.players?.[0];
  const ability = Array.isArray(hostPlayer?.hand)
    ? hostPlayer.hand.find((entry: any) => entry?.abilityId === 'nieyun_zhuyue')
    : null;
  expect(ability?.instanceId, `host player should have 蹑云逐月 in hand: ${bodyText.slice(0, 1000)}`).toBeTruthy();
  return String(ability.instanceId);
}

async function resetCooldowns(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/reset-cooldowns`, { data: { gameId }, timeout: 10_000 });
  const bodyText = await res.text();
  expect(res.ok(), `reset cooldowns failed: status=${res.status()} body=${bodyText}`).toBeTruthy();
}

async function setPlayerPositions(page: Page, baseUrl: string, gameId: string, testCase: CameraDashCase) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/set-player-positions`, {
    data: {
      gameId,
      positions: [
        { playerIndex: 0, x: testCase.host.x, y: testCase.host.y, faceTargetX: testCase.guest.x, faceTargetY: testCase.guest.y },
        { playerIndex: 1, x: testCase.guest.x, y: testCase.guest.y, faceTargetX: testCase.host.x, faceTargetY: testCase.host.y },
      ],
    },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `set positions failed: status=${res.status()} body=${bodyText}`).toBeTruthy();
}

async function readCameraProbe(page: Page) {
  return page.evaluate(() => (window as any).__zhenchuanCameraDashProbe ?? { active: false, dashes: [], samples: [] });
}

async function readDashProbeStarts(page: Page) {
  return page.evaluate(() => Number((window as any).__zhenchuanDashProbe?.starts ?? 0));
}

async function clearCameraProbe(page: Page) {
  await page.evaluate(() => {
    const previous = (window as any).__zhenchuanCameraDashProbe;
    (window as any).__zhenchuanCameraDashProbe = { active: false, dashes: [], samples: [], last: previous?.last ?? null };
  });
}

async function refreshGameForProbe(page: Page) {
  const result = await page.evaluate(async () => {
    const refresh = (window as any).__zhenchuanRefreshGameForProbe;
    if (typeof refresh !== 'function') return { ok: false, error: 'refresh helper missing' };
    return Promise.race([
      refresh().then(() => ({ ok: true })).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
      new Promise<{ ok: false; error: string }>((resolve) => window.setTimeout(() => resolve({ ok: false, error: 'refresh timeout' }), 6_000)),
    ]);
  });
  if (!result.ok) console.log(`[camera-dash] refresh warning: ${result.error}`);
  await page.waitForTimeout(250);
}

async function waitForPositionSync(page: Page, position: { x: number; y: number }) {
  const synced = await page.waitForFunction((expected) => {
    const last = (window as any).__zhenchuanCameraDashProbe?.last;
    const server = last?.serverPosition;
    if (!server) return false;
    return Math.hypot(server.x - expected.x, server.y - expected.y) < 35;
  }, position, { timeout: 8_000 }).then(() => true).catch(() => false);
  if (!synced) {
    const probe = await readCameraProbe(page);
    const server = probe?.last?.serverPosition;
    console.log(`[camera-dash] position sync timeout expected=(${position.x},${position.y}) server=${server ? `(${server.x?.toFixed?.(1) ?? server.x},${server.y?.toFixed?.(1) ?? server.y})` : 'none'}`);
  }
  await page.waitForTimeout(500);
}

async function castNieyunAndReadSummary(page: Page, baseUrl: string, gameId: string, abilityInstanceId: string) {
  const beforeProbe = await readCameraProbe(page);
  const beforeDashes = Array.isArray(beforeProbe.dashes) ? beforeProbe.dashes.length : 0;
  const result = await page.evaluate(async (id) => {
    const cast = (window as any).__zhenchuanCastAbilityForProbe;
    if (typeof cast !== 'function') return { ok: false, error: 'cast helper missing' };
    return Promise.race([
      cast(id, { movementIntent: false }).then(() => ({ ok: true })).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
      new Promise<{ ok: false; error: string }>((resolve) => window.setTimeout(() => resolve({ ok: false, error: 'cast timeout' }), 6_000)),
    ]);
  }, abilityInstanceId);
  if (!result.ok) {
    return {
      samples: 0,
      collisionAware: false,
      stoppedByCollision: false,
      maxCollisionDelta: 0,
      maxRenderPredictionGap: Number.POSITIVE_INFINITY,
      error: `dash cast failed: ${result.error ?? 'unknown error'}`,
    };
  }
  await page.waitForTimeout(1_500);
  const probe = await readCameraProbe(page);
  if (Array.isArray(probe.dashes) && probe.dashes.length > beforeDashes) {
    return probe.dashes[probe.dashes.length - 1];
  }
  if (probe.current && Number(probe.current.samples ?? 0) > 0) return probe.current;
  return {
    samples: 0,
    collisionAware: false,
    stoppedByCollision: false,
    maxCollisionDelta: 0,
    maxRenderPredictionGap: Number.POSITIVE_INFINITY,
    error: `dash was not observed after in-page cast for game ${gameId}`,
  };
}

function evaluateCameraDashResult(testCase: CameraDashCase, gameId: string, summary: any): CameraDashResult {
  const maxCollisionDelta = Number(summary?.maxCollisionDelta ?? 0);
  const maxRenderPredictionGap = Number(summary?.maxRenderPredictionGap ?? Number.POSITIVE_INFINITY);
  const sampleCount = Number(summary?.samples ?? 0);
  const collisionAware = summary?.collisionAware === true;
  const stoppedByCollision = summary?.stoppedByCollision === true;
  const success = collisionAware && sampleCount > 0 && maxRenderPredictionGap < 0.2 && (stoppedByCollision || maxCollisionDelta > 0.12);
  const reason = success
    ? 'ok'
    : `collisionAware=${collisionAware} samples=${sampleCount} stopped=${stoppedByCollision} collisionDelta=${maxCollisionDelta.toFixed(3)} renderGap=${maxRenderPredictionGap.toFixed(3)}`;
  return { ...testCase, gameId, success, reason, summary };
}

test.describe('live camera dash collision prediction', () => {
  test('camera follows collision-aware dash prediction into houses mountains and walls', async ({ browser }, testInfo) => {
    test.setTimeout(600_000);

    const baseUrl = getLiveBaseUrl(testInfo);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const results: CameraDashResult[] = [];
    let activeGameId: string | null = null;

    try {
      const hostCredentials = await getOrCreateCredentials(host, baseUrl, 'host');
      const guestCredentials = await getOrCreateCredentials(guest, baseUrl, 'guest');
      await login(host, baseUrl, hostCredentials.username, hostCredentials.password);
      await login(guest, baseUrl, guestCredentials.username, guestCredentials.password);

      activeGameId = await createCollisionTestBattle(host, guest, baseUrl);
      await waitForBattleCanvas(host, baseUrl, activeGameId);
      const nieyunInstanceId = await getNieyunInstanceId(host, baseUrl, activeGameId);

      for (const testCase of CAMERA_DASH_CASES) {
        await clearCameraProbe(host);
        await setPlayerPositions(host, baseUrl, activeGameId, testCase);
        await resetCooldowns(host, baseUrl, activeGameId);
        await waitForPositionSync(host, testCase.host);
        const summary = await castNieyunAndReadSummary(host, baseUrl, activeGameId, nieyunInstanceId);
        const result = evaluateCameraDashResult(testCase, activeGameId, summary);
        results.push(result);
        console.log(`[camera-dash] ${testCase.category}/${testCase.label}: ${result.reason}`);
      }

      const successCount = results.filter((result) => result.success).length;
      const categories = new Set(results.filter((result) => result.success).map((result) => result.category));
      await testInfo.attach('camera-dash-collision-results.json', {
        body: JSON.stringify({ successCount, results }, null, 2),
        contentType: 'application/json',
      });
      expect(successCount, JSON.stringify(results, null, 2)).toBeGreaterThanOrEqual(REQUIRED_SUCCESS_COUNT);
      expect(categories.has('house'), 'house cases should pass').toBe(true);
      expect(categories.has('mountain'), 'mountain cases should pass').toBe(true);
      expect(categories.has('wall'), 'wall cases should pass').toBe(true);
    } finally {
      await testInfo.attach('camera-dash-collision-results-final.json', {
        body: JSON.stringify({ activeGameId, results }, null, 2),
        contentType: 'application/json',
      }).catch(() => undefined);
      if (activeGameId) await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId: activeGameId } }).catch(() => undefined);
      await hostContext.close();
      await guestContext.close();
    }
  });
});