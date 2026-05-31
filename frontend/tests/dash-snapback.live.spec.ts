import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';
const DASH_COUNT = 10;

test.use({
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});

type FrontendCorrectionProbe = {
  reason?: string;
  xyError?: number;
  zError?: number;
  activeDash?: boolean;
  server?: unknown;
  local?: unknown;
  dashNumber: number;
  raw: string;
};

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
    username: `dash_${label}_${unique}`,
    password: `dash-${unique}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

async function createTemporaryUser(page: Page, baseUrl: string, label: string): Promise<LoginCredentials> {
  const credentials = makeTemporaryCredentials(label);
  const res = await page.request.post(`${baseUrl}/api/auth/bootstrap`, {
    data: credentials,
  });
  expect(res.ok()).toBeTruthy();
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

async function createLiveYumenBattle(host: Page, guest: Page, baseUrl: string) {
  const createRes = await host.request.post(`${baseUrl}/api/game/create`, {
    data: { mode: 'yumenguan-classic' },
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

async function enableShortCooldown(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/yumen/test-short-cooldown`, {
    data: { gameId, enabled: true },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `short cooldown setup failed: status=${res.status()} body=${bodyText}`).toBeTruthy();
  const body = JSON.parse(bodyText);
  expect(body.enabled).toBe(true);
}

async function resetCooldowns(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/reset-cooldowns`, {
    data: { gameId },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `reset cooldowns failed: status=${res.status()} body=${bodyText}`).toBeTruthy();
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

async function waitForBattleCanvas(page: Page, baseUrl: string, gameId: string) {
  await page.goto(`${baseUrl}/game/in-game?gameId=${gameId}&playwrightDashProbe=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('canvas')).some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = window.getComputedStyle(canvas);
      return rect.width >= 200 && rect.height >= 200 && style.display !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 90_000 });

  const canvasBox = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('canvas'))
      .map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        const style = window.getComputedStyle(canvas);
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          visible: rect.width >= 200 && rect.height >= 200 && style.display !== 'none' && style.visibility !== 'hidden',
        };
      })
      .filter((candidate) => candidate.visible)
      .sort((left, right) => right.width * right.height - left.width * left.height);
    return candidates[0] ?? null;
  });
  expect(canvasBox, 'battle page should expose a visible gameplay canvas').toBeTruthy();
  await page.mouse.click(canvasBox!.x + Math.min(120, canvasBox!.width / 2), canvasBox!.y + Math.min(120, canvasBox!.height / 2));
}

async function readDashProbe(page: Page) {
  return withTimeout(page.evaluate(() => {
    const probe = (window as any).__zhenchuanDashProbe ?? {};
    return {
      starts: Number(probe.starts ?? 0),
      ends: Number(probe.ends ?? 0),
      corrections: Array.isArray(probe.corrections) ? probe.corrections : [],
      events: Array.isArray(probe.events) ? probe.events : [],
    };
  }), 5_000, 'readDashProbe');
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function castNieyunUntilObserved(page: Page, baseUrl: string, gameId: string, abilityInstanceId: string, expectedStarts: number, label: string, getStarts: () => number) {
  const deadline = Date.now() + 35_000;
  let attempts = 0;
  console.log(`[dash-snapback] ${label}: waiting for frontend start ${expectedStarts}, initial starts=${getStarts()}`);
  while (Date.now() < deadline) {
    attempts += 1;
    await resetCooldowns(page, baseUrl, gameId);
    const res = await page.request.post(`${baseUrl}/api/game/play`, {
      data: { gameId, abilityInstanceId, movementIntent: false },
      timeout: 10_000,
    });
    const bodyText = await res.text();
    if (!res.ok()) {
      console.log(`[dash-snapback] ${label}: cast rejected status=${res.status()} body=${bodyText.slice(0, 300)}`);
      const retryDelayMs = bodyText.includes('ERR_QINGGONG_SEALED') ? 1_200 : 700;
      await page.waitForTimeout(retryDelayMs);
      continue;
    }
    await page.waitForTimeout(1_200);
    if (getStarts() >= expectedStarts) return;
    if (attempts % 5 === 0) {
      console.log(`[dash-snapback] ${label}: attempts=${attempts}, starts=${getStarts()}`);
    }
    await page.waitForTimeout(800);
  }
  expect(getStarts(), `${label}: frontend should observe 蹑云 dash`).toBeGreaterThanOrEqual(expectedStarts);
}

function getSnapbackCorrections(probe: Awaited<ReturnType<typeof readDashProbe>>) {
  return probe.corrections.filter((entry: any) => entry?.reason === 'recent-dash-snap' || entry?.reason === 'hard-snap-xy');
}

function parseFrontendCorrectionProbe(text: string): Omit<FrontendCorrectionProbe, 'dashNumber' | 'raw'> | null {
  const marker = '[LAG-PROBE][frontend] ';
  const index = text.indexOf(marker);
  if (index < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(index + marker.length));
    if (parsed?.kind !== 'frontend-position-correction') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function attachDashDiagnostics(
  testInfo: TestInfo,
  data: {
    gameId: string | null;
    acceptedCasts: number;
    dashStarts: number;
    dashEnds: number;
    corrections: FrontendCorrectionProbe[];
    stutters: string[];
    dashProbe?: unknown;
  }
) {
  await testInfo.attach('dash-snapback-diagnostics.json', {
    body: JSON.stringify(data, null, 2),
    contentType: 'application/json',
  });
}

test.describe('live dash snapback regression', () => {
  test('ten frontend dashes do not emit snapback corrections', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);

    const baseUrl = getLiveBaseUrl(testInfo);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    let gameId: string | null = null;
    let monitoring = false;
    let acceptedCasts = 0;
    let dashStarts = 0;
    let dashEnds = 0;
    const corrections: FrontendCorrectionProbe[] = [];
    const stutters: string[] = [];

    host.on('console', (message) => {
      const text = message.text();
      if (text.includes('[DASH] >>> FRONTEND START')) dashStarts += 1;
      if (text.includes('[DASH] <<< FRONTEND END')) dashEnds += 1;
      if (!monitoring) return;
      if (text.includes('[DASH-STUTTER]')) stutters.push(text);
      const probe = parseFrontendCorrectionProbe(text);
      if (!probe) return;
      if (probe.reason === 'recent-dash-snap' || probe.reason === 'hard-snap-xy') {
        corrections.push({ ...probe, dashNumber: dashStarts, raw: text });
      }
    });

    try {
      const hostCredentials = await getOrCreateCredentials(host, baseUrl, 'host');
      const guestCredentials = await getOrCreateCredentials(guest, baseUrl, 'guest');
      await login(host, baseUrl, hostCredentials.username, hostCredentials.password);
      await login(guest, baseUrl, guestCredentials.username, guestCredentials.password);
      console.log('[dash-snapback] logged in both test users');
      gameId = await createLiveYumenBattle(host, guest, baseUrl);
      console.log(`[dash-snapback] created live game ${gameId}`);
      await waitForBattleCanvas(host, baseUrl, gameId);
      console.log('[dash-snapback] host battle canvas ready');
      console.log('[dash-snapback] enabling short cooldown');
      await enableShortCooldown(host, baseUrl, gameId);
      console.log('[dash-snapback] short cooldown enabled');
      const nieyunInstanceId = await getNieyunInstanceId(host, baseUrl, gameId);
      await host.waitForTimeout(1_000);
      console.log('[dash-snapback] starting frontend dash loop');

      monitoring = true;
      for (let dashIndex = 0; dashIndex < DASH_COUNT; dashIndex += 1) {
        const expectedStarts = dashStarts + 1;
        await castNieyunUntilObserved(host, baseUrl, gameId, nieyunInstanceId, expectedStarts, `dash ${dashIndex + 1}`, () => dashStarts);
        acceptedCasts += 1;
        console.log(`[dash-snapback] observed frontend dash ${acceptedCasts}/${DASH_COUNT}`);
        await host.waitForTimeout(3_400);

        expect(corrections, `dash ${dashIndex + 1}: snapback correction probes`).toHaveLength(0);
      }

      await host.waitForTimeout(1_000);
      const finalProbe = await readDashProbe(host).catch((error) => ({ error: String(error) }));
      await attachDashDiagnostics(testInfo, { gameId, acceptedCasts, dashStarts, dashEnds, corrections, stutters, dashProbe: finalProbe });
      expect(acceptedCasts, 'the frontend must observe at least ten dash starts').toBeGreaterThanOrEqual(DASH_COUNT);
      expect(dashStarts, 'the test must exercise at least ten frontend dashes').toBeGreaterThanOrEqual(DASH_COUNT);
      if ('corrections' in finalProbe) {
        expect(getSnapbackCorrections(finalProbe), 'no snapback probes in browser dash probe').toHaveLength(0);
      }
      expect(corrections, 'no recent-dash-snap or hard-snap-xy probes after dash monitoring starts').toHaveLength(0);
    } finally {
      monitoring = false;
      const dashProbe = await readDashProbe(host).catch(() => undefined);
      await attachDashDiagnostics(testInfo, { gameId, acceptedCasts, dashStarts, dashEnds, corrections, stutters, dashProbe }).catch(() => undefined);
      await Promise.race([
        host.evaluate(() => {
          (window as any).__zhenchuanCrashRecorder?.endSession?.('playwright-dash-snapback-cleanup', { clearUploadedLogs: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]).catch(() => undefined);
      if (gameId) {
        await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId } }).catch(() => undefined);
      }
      await hostContext.close();
      await guestContext.close();
    }
  });
});