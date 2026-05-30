import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';
const REQUIRED_SUCCESS_COUNT = 1;
const DEFAULT_CAMERA_PITCH = Math.atan2(7, 20);
const STRAIGHT_UP_PITCH_LIMIT = -Math.PI * 0.49;
const WALL_TEST_ZOOM = 1.3;
const WALL_YAW_CANDIDATES = [
  (-Math.PI * 3) / 4,
  -2.2,
  -2.5,
  0,
  Math.PI / 2,
  Math.PI,
  -Math.PI / 2,
  Math.PI / 4,
  -Math.PI / 4,
  (Math.PI * 3) / 4,
];

test.use({
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});

type LoginCredentials = {
  username: string;
  password: string;
};

type CameraWallBodyCase = {
  label: string;
  category: 'house' | 'city-wall' | 'mountain';
  host: { x: number; y: number };
  guest: { x: number; y: number };
};

type CameraWallBodyResult = CameraWallBodyCase & {
  success: boolean;
  reason: string;
  yaw: number | null;
  wallSample: any;
  groundSample: any;
  gameId: string;
};

const CAMERA_WALL_BODY_CASES: CameraWallBodyCase[] = [
  { label: 'verified west edge', category: 'house', host: { x: 238, y: 426 }, guest: { x: 320, y: 426 } },
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
    username: `camera_wall_${label}_${unique}`,
    password: `camera-wall-${unique}-${Math.random().toString(36).slice(2, 10)}`,
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
  const createRes = await host.request.post(`${baseUrl}/api/game/create`, { data: { mode: 'collision-test' } });
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
  await page.goto(`${baseUrl}/game/in-game?gameId=${gameId}&playwrightCameraDashProbe=1&playwrightCameraSkyProbe=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('canvas')).some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = window.getComputedStyle(canvas);
      return rect.width >= 200 && rect.height >= 200 && style.display !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as any).__zhenchuanCameraSkyProbe?.last?.collisionReady === true, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => typeof (window as any).__zhenchuanSetCameraForProbe === 'function', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => typeof (window as any).__zhenchuanRefreshGameForProbe === 'function', undefined, { timeout: 20_000 });
}

async function setPlayerPositions(page: Page, baseUrl: string, gameId: string, testCase: CameraWallBodyCase) {
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

async function refreshGameForProbe(page: Page) {
  await page.evaluate(async () => {
    const refresh = (window as any).__zhenchuanRefreshGameForProbe;
    if (typeof refresh !== 'function') return;
    await Promise.race([
      refresh().catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, 6_000)),
    ]);
  });
  await page.waitForTimeout(300);
}

async function waitForPositionSync(page: Page, position: { x: number; y: number }) {
  await page.waitForFunction((expected) => {
    const server = (window as any).__zhenchuanCameraDashProbe?.last?.serverPosition;
    return !!server && Math.hypot(server.x - expected.x, server.y - expected.y) < 35;
  }, position, { timeout: 8_000 });
  await page.waitForTimeout(300);
}

async function resetSkyProbe(page: Page) {
  await page.evaluate(() => {
    const probe = (window as any).__zhenchuanCameraSkyProbe;
    if (!probe) return;
    probe.samples = [];
    probe.last = null;
    probe.maxLookVectorY = -1;
    probe.minActualDistance = Number.POSITIVE_INFINITY;
    probe.maxLookUpRatio = 0;
  });
}

async function setCameraAndRead(page: Page, camera: { yaw: number; pitch: number; zoom: number }, settleMs = 900) {
  const appliedCamera = await page.evaluate((next) => {
    const setCamera = (window as any).__zhenchuanSetCameraForProbe;
    if (typeof setCamera !== 'function') return next;
    return setCamera(next) ?? next;
  }, camera);
  const expected = {
    yaw: Number(appliedCamera?.yaw ?? camera.yaw),
    pitch: Number(appliedCamera?.pitch ?? camera.pitch),
  };
  let bestSample: any = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beforeSampleCount = await page.evaluate(() => {
      const samples = (window as any).__zhenchuanCameraSkyProbe?.samples;
      return Array.isArray(samples) ? samples.length : 0;
    });
    await page.evaluate((next) => {
      const setCamera = (window as any).__zhenchuanSetCameraForProbe;
      if (typeof setCamera === 'function') setCamera(next);
    }, camera);
    await page.waitForTimeout(settleMs + attempt * 350);
    const sample = await page.evaluate(({ expected, beforeSampleCount }) => {
      const probe = (window as any).__zhenchuanCameraSkyProbe;
      const samples = Array.isArray(probe?.samples) ? probe.samples : [];
      const candidate = probe?.last ?? samples[samples.length - 1] ?? null;
      const sampleCount = samples.length;
      if (!candidate) {
        return {
          collisionReady: false,
          probeMissing: true,
          probeSampleCount: sampleCount,
          probeSampleFresh: sampleCount > beforeSampleCount,
          expectedYaw: expected.yaw,
          expectedPitch: expected.pitch,
        };
      }
      const yawError = Math.abs(Number(candidate.yaw ?? 0) - expected.yaw);
      const pitchError = Math.abs(Number(candidate.pitch ?? 0) - expected.pitch);
      return {
        ...candidate,
        probeSampleCount: sampleCount,
        probeSampleFresh: sampleCount > beforeSampleCount,
        expectedYaw: expected.yaw,
        expectedPitch: expected.pitch,
        yawError,
        pitchError,
      };
    }, { expected, beforeSampleCount });

    bestSample = sample;
    if (sample?.collisionReady === true && Number(sample?.yawError ?? 1) <= 0.15 && Number(sample?.pitchError ?? 1) <= 0.2) {
      return sample;
    }
  }

  return bestSample;
}

function evaluateWallBodySample(sample: any) {
  const desiredDistance = Number(sample?.desiredDistance ?? 0);
  const actualDistance = Number(sample?.actualDistance ?? 0);
  const reduction = desiredDistance - actualDistance;
  const wallHitCount = Number(sample?.wallHitCount ?? 0);
  const probeHitCount = Number(sample?.probeHitCount ?? 0);
  const bodyClearance = Number(sample?.wallBodyClearance ?? Number.NEGATIVE_INFINITY);
  const success =
    sample?.collisionReady === true &&
    Number(sample?.yawError ?? 1) <= 0.15 &&
    Number(sample?.pitchError ?? 1) <= 0.2 &&
    (sample?.wallClamp === true || sample?.probeClamp === true) &&
    wallHitCount + probeHitCount >= 1 &&
    reduction >= 0.32 &&
    bodyClearance >= -0.25 &&
    actualDistance >= 0.8;
  const reason = success
    ? 'ok'
    : `fresh=${sample?.probeSampleFresh === true} ready=${sample?.collisionReady === true} yawErr=${Number(sample?.yawError ?? -1).toFixed(2)} pitchErr=${Number(sample?.pitchError ?? -1).toFixed(2)} wall=${sample?.wallClamp === true} probe=${sample?.probeClamp === true} hits=${wallHitCount + probeHitCount} reduction=${reduction.toFixed(2)} clearance=${bodyClearance.toFixed(2)} actual=${actualDistance.toFixed(2)} masks=${sample?.wallHitMask ?? ''}/${sample?.probeHitMask ?? ''}`;
  return { success, reason, reduction, bodyClearance };
}

function evaluateGroundBodySample(sample: any) {
  const groundClearance = Number(sample?.groundClearance ?? Number.NEGATIVE_INFINITY);
  const groundSupportHitCount = Number(sample?.groundSupportHitCount ?? 0);
  const success =
    sample?.collisionReady === true &&
    Number(sample?.pitchError ?? 1) <= 0.2 &&
    sample?.groundClamp === true &&
    groundSupportHitCount >= 1 &&
    groundClearance >= -0.03 &&
    Number(sample?.lookVectorY ?? -1) >= 0.72;
  const reason = success
    ? 'ok'
    : `fresh=${sample?.probeSampleFresh === true} ready=${sample?.collisionReady === true} pitchErr=${Number(sample?.pitchError ?? -1).toFixed(2)} ground=${sample?.groundClamp === true} supports=${groundSupportHitCount} clearance=${groundClearance.toFixed(3)} lookY=${Number(sample?.lookVectorY ?? -1).toFixed(3)} supportMask=${sample?.groundSupportHitMask ?? ''}`;
  return { success, reason, groundClearance };
}

async function runCameraWallBodyCase(page: Page, baseUrl: string, gameId: string, testCase: CameraWallBodyCase, preparePosition: boolean): Promise<CameraWallBodyResult> {
  await page.keyboard.up('w').catch(() => undefined);
  if (preparePosition) {
    await setPlayerPositions(page, baseUrl, gameId, testCase);
    await refreshGameForProbe(page);
    await waitForPositionSync(page, testCase.host);
  }
  await resetSkyProbe(page);

  let bestWallSample: any = null;
  let bestWallReason = 'no samples';
  let bestYaw: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const yaw of WALL_YAW_CANDIDATES) {
    const sample = await setCameraAndRead(page, { yaw, pitch: DEFAULT_CAMERA_PITCH, zoom: WALL_TEST_ZOOM });
    const wallEval = evaluateWallBodySample(sample);
    console.log(`[camera-wall-body] yaw ${testCase.category}/${testCase.label} ${yaw.toFixed(3)}: ${wallEval.reason}`);
    const score = wallEval.reduction + wallEval.bodyClearance + Number(sample?.wallHitCount ?? 0) + Number(sample?.probeHitCount ?? 0);
    if (score > bestScore) {
      bestScore = score;
      bestWallSample = sample;
      bestWallReason = wallEval.reason;
      bestYaw = yaw;
    }
    if (wallEval.success) {
      const groundSample = await setCameraAndRead(page, { yaw, pitch: STRAIGHT_UP_PITCH_LIMIT, zoom: 1 }, 900);
      const groundEval = evaluateGroundBodySample(groundSample);
      const success = groundEval.success;
      const reason = success ? 'ok' : `ground body failed after wall body ok: ${groundEval.reason}`;
      console.log(`[camera-wall-body] ground ${testCase.category}/${testCase.label} ${yaw.toFixed(3)}: ${groundEval.reason}`);
      return { ...testCase, gameId, success, reason, yaw, wallSample: sample, groundSample };
    }
  }

  return { ...testCase, gameId, success: false, reason: bestWallReason, yaw: bestYaw, wallSample: bestWallSample, groundSample: null };
}

test.describe('live camera wall body collision', () => {
  test('camera body stays out of walls and above ground at the verified wall edge', async ({ browser }, testInfo) => {
    test.setTimeout(600_000);

    const baseUrl = getLiveBaseUrl(testInfo);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const results: CameraWallBodyResult[] = [];
    let activeGameId: string | null = null;

    try {
      const hostCredentials = await getOrCreateCredentials(host, baseUrl, 'host');
      const guestCredentials = await getOrCreateCredentials(guest, baseUrl, 'guest');
      await login(host, baseUrl, hostCredentials.username, hostCredentials.password);
      await login(guest, baseUrl, guestCredentials.username, guestCredentials.password);

      activeGameId = await createCollisionTestBattle(host, guest, baseUrl);
      await waitForBattleCanvas(host, baseUrl, activeGameId);

      for (const [caseIndex, testCase] of CAMERA_WALL_BODY_CASES.entries()) {
        const result = await runCameraWallBodyCase(host, baseUrl, activeGameId, testCase, caseIndex === 0);
        results.push(result);
        const reduction = Number(result.wallSample?.desiredDistance ?? 0) - Number(result.wallSample?.actualDistance ?? 0);
        const clearance = Number(result.wallSample?.wallBodyClearance ?? Number.NaN);
        const groundClearance = Number(result.groundSample?.groundClearance ?? Number.NaN);
        console.log(`[camera-wall-body] ${testCase.category}/${testCase.label}: ${result.reason} yaw=${result.yaw?.toFixed(3) ?? 'none'} reduction=${reduction.toFixed(2)} bodyClearance=${clearance.toFixed(2)} groundClearance=${groundClearance.toFixed(3)}`);
      }

      const successCount = results.filter((result) => result.success).length;
      await testInfo.attach('camera-wall-body-results.json', {
        body: JSON.stringify({ successCount, results }, null, 2),
        contentType: 'application/json',
      });
      expect(successCount, JSON.stringify(results, null, 2)).toBeGreaterThanOrEqual(REQUIRED_SUCCESS_COUNT);
    } finally {
      await testInfo.attach('camera-wall-body-results-final.json', {
        body: JSON.stringify({ activeGameId, results }, null, 2),
        contentType: 'application/json',
      }).catch(() => undefined);
      if (activeGameId) await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId: activeGameId } }).catch(() => undefined);
      await hostContext.close();
      await guestContext.close();
    }
  });
});