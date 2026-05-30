import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';
const REQUIRED_STATIONARY_SUCCESS_COUNT = 10;
const REQUIRED_SMOOTH_SUCCESS_COUNT = 10;
const REQUIRED_W_PRESERVE_SUCCESS_COUNT = 10;
const DEFAULT_CAMERA_PITCH = Math.atan2(10, 20);
const STRAIGHT_UP_PITCH_LIMIT = -Math.PI * 0.49;
const SMOOTH_DRAG_STEPS = 8;
const MIN_SMOOTH_SAMPLE_COUNT = SMOOTH_DRAG_STEPS - 3;
const SMOOTH_SAMPLE_DEADLINE_MS = 120;
const SMOOTH_SAMPLE_POLL_MS = 20;
const SMOOTH_MAX_LOOK_STEP = 0.85;
const PROBE_SAMPLE_TIMEOUT_MS = 8_000;

test.use({
  trace: 'off',
  screenshot: 'off',
  video: 'off',
});

type LoginCredentials = {
  username: string;
  password: string;
};

type CameraSkyCase = {
  label: string;
  category: 'house' | 'city-wall' | 'mountain';
  host: { x: number; y: number };
  guest: { x: number; y: number };
};

type CameraSkyResult = CameraSkyCase & {
  mode: 'stationary' | 'forward';
  success: boolean;
  reason: string;
  summary: any;
  gameId: string;
};

type CameraSmoothTransitionResult = CameraSkyCase & {
  success: boolean;
  reason: string;
  upSamples: any[];
  downSamples: any[];
  gameId: string;
};

type CameraWPreserveResult = CameraSkyCase & {
  success: boolean;
  reason: string;
  before: any;
  during: any;
  after: any;
  gameId: string;
};

const CAMERA_SKY_CASES: CameraSkyCase[] = [
  { label: 'house west edge far', category: 'house', host: { x: 227, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'house west edge near', category: 'house', host: { x: 238, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'house east edge near', category: 'house', host: { x: 312, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'house east edge far', category: 'house', host: { x: 323, y: 426 }, guest: { x: 230, y: 426 } },
  { label: '城墙 west face far', category: 'city-wall', host: { x: 227, y: 426 }, guest: { x: 320, y: 426 } },
  { label: '城墙 west face near', category: 'city-wall', host: { x: 238, y: 426 }, guest: { x: 320, y: 426 } },
  { label: '城墙 east face near', category: 'city-wall', host: { x: 312, y: 426 }, guest: { x: 230, y: 426 } },
  { label: '城墙 east face far', category: 'city-wall', host: { x: 323, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'mountain west edge far', category: 'mountain', host: { x: 227, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'mountain west edge near', category: 'mountain', host: { x: 238, y: 426 }, guest: { x: 320, y: 426 } },
  { label: 'mountain east edge near', category: 'mountain', host: { x: 312, y: 426 }, guest: { x: 230, y: 426 } },
  { label: 'mountain east edge far', category: 'mountain', host: { x: 323, y: 426 }, guest: { x: 230, y: 426 } },
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
    username: `camera_sky_${label}_${unique}`,
    password: `camera-sky-${unique}-${Math.random().toString(36).slice(2, 10)}`,
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
}

async function setPlayerPositions(page: Page, baseUrl: string, gameId: string, testCase: CameraSkyCase) {
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
  await page.waitForTimeout(250);
}

async function waitForPositionSync(page: Page, position: { x: number; y: number }) {
  await page.waitForFunction((expected) => {
    const server = (window as any).__zhenchuanCameraDashProbe?.last?.serverPosition;
    return !!server && Math.hypot(server.x - expected.x, server.y - expected.y) < 35;
  }, position, { timeout: 8_000 });
  await page.waitForTimeout(250);
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

async function getSkyProbeSampleCount(page: Page) {
  return page.evaluate(() => {
    const samples = (window as any).__zhenchuanCameraSkyProbe?.samples;
    return Array.isArray(samples) ? samples.length : 0;
  });
}

async function setCameraForProbe(page: Page, overrides: { yaw?: number; pitch?: number; zoom?: number } = {}, settleMs = 150) {
  const camera = { yaw: 0, pitch: DEFAULT_CAMERA_PITCH, zoom: 1, ...overrides };
  await page.evaluate((camera) => {
    const setCamera = (window as any).__zhenchuanSetCameraForProbe;
    if (typeof setCamera === 'function') setCamera(camera);
  }, camera);
  await page.waitForTimeout(settleMs);
}

async function getLargestCanvasBox(page: Page) {
  const box = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas'))
      .map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, area: rect.width * rect.height };
      })
      .filter((rect) => rect.width >= 200 && rect.height >= 200)
      .sort((a, b) => b.area - a.area)[0] ?? null;
  });
  expect(box).toBeTruthy();
  return box!;
}

async function dragCameraUpAndRead(page: Page, holdMs: number) {
  const box = await getLargestCanvasBox(page);
  const x = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.92;
  const endY = box.y - box.height * 0.55;

  const result = await page.evaluate(async ({ x, startY, endY, holdMs }) => {
    const makeMouseEvent = (type: string, y: number) => new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      clientX: x,
      clientY: y,
      view: window,
    });
    window.dispatchEvent(makeMouseEvent('mousedown', startY));
    window.dispatchEvent(makeMouseEvent('mousemove', endY));
    let snapshot = null;
    const deadline = window.performance.now() + holdMs + 1_000;
    while (!snapshot && window.performance.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      snapshot = (window as any).__zhenchuanCameraSkyProbe?.last ?? null;
    }
    window.dispatchEvent(makeMouseEvent('mouseup', endY));
    return snapshot;
  }, { x, startY, endY, holdMs });
  expect(result, 'camera sky probe should have a sample after dragging').toBeTruthy();
  return result;
}

async function readSkyProbeLast(
  page: Page,
  message: string,
  options: { expectedPitch?: number; forwardMove?: boolean; afterSampleCount?: number; timeoutMs?: number } = {},
) {
  const result = await page.evaluate(async ({ expectedPitch, forwardMove, afterSampleCount, timeoutMs }) => {
    const deadline = window.performance.now() + timeoutMs;
    while (window.performance.now() <= deadline) {
      const probe = (window as any).__zhenchuanCameraSkyProbe;
      const sampleCount = Array.isArray(probe?.samples) ? probe.samples.length : 0;
      const sample = probe?.last ?? null;
      const pitchMatches = typeof expectedPitch !== 'number' || Math.abs(Number(sample?.pitch ?? Number.NaN) - expectedPitch) <= 0.12;
      const forwardMatches = typeof forwardMove !== 'boolean' || sample?.forwardMove === forwardMove;
      const freshEnough = typeof afterSampleCount !== 'number' || sampleCount > afterSampleCount;
      if (sample && pitchMatches && forwardMatches && freshEnough) return sample;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return null;
  }, {
    expectedPitch: options.expectedPitch ?? null,
    forwardMove: typeof options.forwardMove === 'boolean' ? options.forwardMove : null,
    afterSampleCount: options.afterSampleCount ?? null,
    timeoutMs: options.timeoutMs ?? PROBE_SAMPLE_TIMEOUT_MS,
  })
    .catch(() => null);
  expect(result, message).toBeTruthy();
  return result;
}

async function setForwardKeyForProbe(page: Page, down: boolean) {
  if (down) {
    await page.keyboard.down('w');
  } else {
    await page.keyboard.up('w').catch(() => undefined);
  }
  await page.evaluate((isDown) => {
    const setForwardForProbe = (window as any).__zhenchuanSetForwardForProbe;
    if (typeof setForwardForProbe === 'function') setForwardForProbe(isDown);
    window.dispatchEvent(new KeyboardEvent(isDown ? 'keydown' : 'keyup', {
      key: 'w',
      code: 'KeyW',
      bubbles: true,
      cancelable: true,
    }));
    document.dispatchEvent(new KeyboardEvent(isDown ? 'keydown' : 'keyup', {
      key: 'w',
      code: 'KeyW',
      bubbles: true,
      cancelable: true,
    }));
  }, down);
}

async function dragCameraPathAndRead(page: Page, direction: 'up' | 'down') {
  const startPitch = direction === 'up' ? DEFAULT_CAMERA_PITCH : STRAIGHT_UP_PITCH_LIMIT;
  const endPitch = direction === 'up' ? STRAIGHT_UP_PITCH_LIMIT : DEFAULT_CAMERA_PITCH;

  const samples = await page.evaluate(async ({ startPitch, endPitch, steps, sampleDeadlineMs, samplePollMs }) => {
    const setCamera = (window as any).__zhenchuanSetCameraForProbe;
    if (typeof setCamera !== 'function') return [];
    const collected: any[] = [];
    let lastSampleCount = Array.isArray((window as any).__zhenchuanCameraSkyProbe?.samples)
      ? (window as any).__zhenchuanCameraSkyProbe.samples.length
      : 0;

    const waitForCameraFrame = () => new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, samplePollMs);
      window.requestAnimationFrame(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    });

    const readFreshSnapshot = () => {
      const probe = (window as any).__zhenchuanCameraSkyProbe;
      const sampleCount = Array.isArray(probe?.samples) ? probe.samples.length : 0;
      const candidate = probe?.last ?? null;
      if (candidate && sampleCount !== lastSampleCount) {
        lastSampleCount = sampleCount;
        return candidate;
      }
      return null;
    };

    for (let index = 0; index <= steps; index += 1) {
      const pitch = startPitch + ((endPitch - startPitch) * index) / steps;
      setCamera({ pitch });
      const deadline = window.performance.now() + sampleDeadlineMs;
      let snapshot = null;
      while (!snapshot && window.performance.now() < deadline) {
        await waitForCameraFrame();
        snapshot = readFreshSnapshot();
      }
      if (snapshot) collected.push(snapshot);
    }

    setCamera({ pitch: endPitch });
    for (let index = 0; index < 6; index += 1) await waitForCameraFrame();
    const finalSnapshot = (window as any).__zhenchuanCameraSkyProbe?.last ?? null;
    const lastCollected = collected[collected.length - 1] ?? null;
    if (
      finalSnapshot &&
      Math.abs(Number(finalSnapshot.pitch ?? endPitch) - endPitch) <= 0.08 &&
      Math.abs(Number(lastCollected?.pitch ?? Number.NaN) - Number(finalSnapshot.pitch ?? Number.NaN)) > 0.01
    ) {
      collected.push(finalSnapshot);
    }
    return collected;
  }, { startPitch, endPitch, steps: SMOOTH_DRAG_STEPS, sampleDeadlineMs: SMOOTH_SAMPLE_DEADLINE_MS, samplePollMs: SMOOTH_SAMPLE_POLL_MS });

  return samples;
}

async function runSkySequence(page: Page, baseUrl: string, gameId: string, testCase: CameraSkyCase, mode: 'stationary' | 'forward') {
  await page.keyboard.up('w').catch(() => undefined);
  await setPlayerPositions(page, baseUrl, gameId, testCase);
  await refreshGameForProbe(page);
  await page.waitForTimeout(350);
  await resetSkyProbe(page);
  await setCameraForProbe(page);

  if (mode === 'forward') {
    await page.keyboard.down('w');
    await page.waitForTimeout(250);
  }

  try {
    return await dragCameraUpAndRead(page, mode === 'forward' ? 1_200 : 650);
  } finally {
    if (mode === 'forward') await page.keyboard.up('w').catch(() => undefined);
  }
}

async function prepareCameraSkyCase(page: Page, baseUrl: string, gameId: string, testCase: CameraSkyCase, refreshGame = false) {
  await setForwardKeyForProbe(page, false);
  await setPlayerPositions(page, baseUrl, gameId, testCase);
  if (refreshGame) await refreshGameForProbe(page);
  await page.waitForTimeout(350);
}

async function runSmoothTransitionSequence(page: Page) {
  await resetSkyProbe(page);
  await setCameraForProbe(page);

  const upSamples = await dragCameraPathAndRead(page, 'up');
  await page.waitForTimeout(180);
  const downSamples = await dragCameraPathAndRead(page, 'down');
  return { upSamples, downSamples };
}

async function runForwardPreserveSequence(page: Page) {
  await setForwardKeyForProbe(page, false);
  await resetSkyProbe(page);
  await setCameraForProbe(page, { pitch: STRAIGHT_UP_PITCH_LIMIT }, 350);

  const before = await readSkyProbeLast(page, 'camera sky probe should have a before-W sample', {
    expectedPitch: STRAIGHT_UP_PITCH_LIMIT,
    forwardMove: false,
    timeoutMs: 10_000,
  });
  const beforeSampleCount = await getSkyProbeSampleCount(page);
  await setForwardKeyForProbe(page, true);
  await page.waitForTimeout(450);
  const during = await readSkyProbeLast(page, 'camera sky probe should have a W-preserve sample', {
    expectedPitch: STRAIGHT_UP_PITCH_LIMIT,
    forwardMove: true,
    afterSampleCount: beforeSampleCount,
    timeoutMs: 10_000,
  });
  const duringSampleCount = await getSkyProbeSampleCount(page);
  await setForwardKeyForProbe(page, false);
  await page.waitForTimeout(350);
  const after = await readSkyProbeLast(page, 'camera sky probe should have an after-W sample', {
    expectedPitch: STRAIGHT_UP_PITCH_LIMIT,
    forwardMove: false,
    afterSampleCount: duringSampleCount,
    timeoutMs: 10_000,
  });
  return { before, during, after };
}

function evaluateStationaryResult(testCase: CameraSkyCase, gameId: string, summary: any): CameraSkyResult {
  const pitch = Number(summary?.pitch ?? 0);
  const actualDistance = Number(summary?.actualDistance ?? 0);
  const lookVectorY = Number(summary?.lookVectorY ?? -1);
  const lookUpRatio = Number(summary?.lookUpRatio ?? 0);
  const success =
    pitch <= STRAIGHT_UP_PITCH_LIMIT + 0.08 &&
    summary?.groundClamp === true &&
    summary?.skyLook === true &&
    summary?.forwardMove === false &&
    summary?.closeCamera === false &&
    actualDistance >= 4.4 &&
    lookVectorY >= 0.9 &&
    lookUpRatio >= 0.75;
  const reason = success
    ? 'ok'
    : `pitch=${pitch.toFixed(3)} ground=${summary?.groundClamp === true} sky=${summary?.skyLook === true} forward=${summary?.forwardMove === true} close=${summary?.closeCamera === true} dist=${actualDistance.toFixed(2)} lookY=${lookVectorY.toFixed(3)} lookUp=${lookUpRatio.toFixed(3)}`;
  return { ...testCase, mode: 'stationary', gameId, success, reason, summary };
}

function evaluateForwardResult(testCase: CameraSkyCase, gameId: string, summary: any): CameraSkyResult {
  const pitch = Number(summary?.pitch ?? 0);
  const actualDistance = Number(summary?.actualDistance ?? Number.POSITIVE_INFINITY);
  const lookVectorY = Number(summary?.lookVectorY ?? -1);
  const success =
    pitch <= STRAIGHT_UP_PITCH_LIMIT + 0.08 &&
    summary?.groundClamp === true &&
    summary?.skyLook === true &&
    summary?.forwardMove === true &&
    actualDistance <= 4.8 &&
    lookVectorY >= 0.35;
  const reason = success
    ? 'ok'
    : `pitch=${pitch.toFixed(3)} ground=${summary?.groundClamp === true} sky=${summary?.skyLook === true} forward=${summary?.forwardMove === true} dist=${actualDistance.toFixed(2)} lookY=${lookVectorY.toFixed(3)}`;
  return { ...testCase, mode: 'forward', gameId, success, reason, summary };
}

function maxPositiveStep(values: number[]) {
  let maxStep = 0;
  for (let index = 1; index < values.length; index += 1) {
    maxStep = Math.max(maxStep, values[index] - values[index - 1]);
  }
  return maxStep;
}

function maxNegativeStep(values: number[]) {
  let maxStep = 0;
  for (let index = 1; index < values.length; index += 1) {
    maxStep = Math.max(maxStep, values[index - 1] - values[index]);
  }
  return maxStep;
}

function countDrops(values: number[], tolerance: number) {
  let count = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1] - tolerance) count += 1;
  }
  return count;
}

function countRises(values: number[], tolerance: number) {
  let count = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1] + tolerance) count += 1;
  }
  return count;
}

function maxPitchLookError(samples: any[]) {
  return samples.reduce((maxError, sample) => {
    if (!(sample?.groundClamp === true) || Number(sample?.pitch ?? 0) >= 0) return maxError;
    if (Number(sample?.skyLookBlendRatio ?? 1) < 0.95) return maxError;
    const lookVectorY = Number(sample?.lookVectorY ?? 0);
    const pitchLookVectorY = Number(sample?.pitchLookVectorY ?? lookVectorY);
    return Math.max(maxError, Math.abs(lookVectorY - pitchLookVectorY));
  }, 0);
}

function evaluateSmoothTransitionResult(testCase: CameraSkyCase, gameId: string, upSamples: any[], downSamples: any[]): CameraSmoothTransitionResult {
  const upLookValues = upSamples.map((sample) => Number(sample?.lookVectorY ?? -1)).filter(Number.isFinite);
  const downLookValues = downSamples.map((sample) => Number(sample?.lookVectorY ?? -1)).filter(Number.isFinite);
  const finalUp = upSamples[upSamples.length - 1] ?? null;
  const firstDown = downSamples[0] ?? null;
  const finalDown = downSamples[downSamples.length - 1] ?? null;
  const upDropCount = countDrops(upLookValues, 0.08);
  const downRiseCount = countRises(downLookValues, 0.08);
  const upMaxJump = maxPositiveStep(upLookValues);
  const downMaxDrop = maxNegativeStep(downLookValues);
  const pitchLookError = maxPitchLookError([...upSamples, ...downSamples]);
  const success =
    upSamples.length >= MIN_SMOOTH_SAMPLE_COUNT &&
    downSamples.length >= MIN_SMOOTH_SAMPLE_COUNT &&
    Number(finalUp?.pitch ?? 0) <= STRAIGHT_UP_PITCH_LIMIT + 0.08 &&
    Number(finalUp?.lookVectorY ?? -1) >= 0.9 &&
    Number(firstDown?.lookVectorY ?? -1) >= 0.75 &&
    Number(finalDown?.lookVectorY ?? 1) <= Number(firstDown?.lookVectorY ?? 0) - 0.35 &&
    upDropCount <= 1 &&
    downRiseCount <= 1 &&
    upMaxJump <= SMOOTH_MAX_LOOK_STEP &&
    downMaxDrop <= SMOOTH_MAX_LOOK_STEP &&
    pitchLookError <= 0.08;
  const reason = success
    ? 'ok'
    : `upSamples=${upSamples.length} downSamples=${downSamples.length} finalUpPitch=${Number(finalUp?.pitch ?? 0).toFixed(3)} finalUpLookY=${Number(finalUp?.lookVectorY ?? -1).toFixed(3)} finalDownLookY=${Number(finalDown?.lookVectorY ?? -1).toFixed(3)} upDrops=${upDropCount} downRises=${downRiseCount} upJump=${upMaxJump.toFixed(3)} downDrop=${downMaxDrop.toFixed(3)} pitchErr=${pitchLookError.toFixed(3)}`;
  return { ...testCase, gameId, success, reason, upSamples, downSamples };
}

function evaluateWPreserveResult(testCase: CameraSkyCase, gameId: string, before: any, during: any, after: any): CameraWPreserveResult {
  const beforeLookY = Number(before?.lookVectorY ?? -1);
  const duringLookY = Number(during?.lookVectorY ?? -1);
  const afterLookY = Number(after?.lookVectorY ?? -1);
  const duringDistance = Number(during?.actualDistance ?? 0);
  const afterDistance = Number(after?.actualDistance ?? 0);
  const duringDelta = Math.abs(duringLookY - beforeLookY);
  const afterDelta = Math.abs(afterLookY - beforeLookY);
  const success =
    before?.skyLook === true &&
    beforeLookY >= 0.9 &&
    during?.forwardMove === true &&
    during?.skyLook === true &&
    duringDelta <= 0.08 &&
    duringDistance >= 4.4 &&
    during?.closeCamera === false &&
    after?.forwardMove === false &&
    after?.skyLook === true &&
    afterDelta <= 0.08 &&
    afterDistance >= 4.4 &&
    after?.closeCamera === false;
  const reason = success
    ? 'ok'
    : `beforeLookY=${beforeLookY.toFixed(3)} duringLookY=${duringLookY.toFixed(3)} afterLookY=${afterLookY.toFixed(3)} duringDelta=${duringDelta.toFixed(3)} afterDelta=${afterDelta.toFixed(3)} duringForward=${during?.forwardMove === true} duringSky=${during?.skyLook === true} afterSky=${after?.skyLook === true} duringDist=${duringDistance.toFixed(2)} afterDist=${afterDistance.toFixed(2)} close=${during?.closeCamera === true || after?.closeCamera === true}`;
  return { ...testCase, gameId, success, reason, before, during, after };
}

test.describe('live camera sky-look ground clamp', () => {
  test('camera can look straight up without stationary close-body collapse near houses walls and mountains', async ({ browser }, testInfo) => {
    test.setTimeout(1_200_000);

    const baseUrl = getLiveBaseUrl(testInfo);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const stationaryResults: CameraSkyResult[] = [];
    const smoothResults: CameraSmoothTransitionResult[] = [];
    const preserveResults: CameraWPreserveResult[] = [];
    let activeGameId: string | null = null;

    try {
      const hostCredentials = await getOrCreateCredentials(host, baseUrl, 'host');
      const guestCredentials = await getOrCreateCredentials(guest, baseUrl, 'guest');
      await login(host, baseUrl, hostCredentials.username, hostCredentials.password);
      await login(guest, baseUrl, guestCredentials.username, guestCredentials.password);

      activeGameId = await createCollisionTestBattle(host, guest, baseUrl);
      await waitForBattleCanvas(host, baseUrl, activeGameId);

      for (const [caseIndex, testCase] of CAMERA_SKY_CASES.slice(0, REQUIRED_STATIONARY_SUCCESS_COUNT).entries()) {
        await prepareCameraSkyCase(host, baseUrl, activeGameId, testCase, caseIndex === 0);

        const { upSamples, downSamples } = await runSmoothTransitionSequence(host);
        const smoothResult = evaluateSmoothTransitionResult(testCase, activeGameId, upSamples, downSamples);
        smoothResults.push(smoothResult);
        console.log(`[camera-sky] smooth ${testCase.category}/${testCase.label}: ${smoothResult.reason}`);

        const summary = upSamples[upSamples.length - 1];
        const result = evaluateStationaryResult(testCase, activeGameId, summary);
        stationaryResults.push(result);
        console.log(`[camera-sky] stationary ${testCase.category}/${testCase.label}: ${result.reason}`);

        const preserveSummary = await runForwardPreserveSequence(host);
        const preserveResult = evaluateWPreserveResult(testCase, activeGameId, preserveSummary.before, preserveSummary.during, preserveSummary.after);
        preserveResults.push(preserveResult);
        console.log(`[camera-sky] w-preserve ${testCase.category}/${testCase.label}: ${preserveResult.reason}`);
      }

      const stationarySuccessCount = stationaryResults.filter((result) => result.success).length;
      const smoothSuccessCount = smoothResults.filter((result) => result.success).length;
      const preserveSuccessCount = preserveResults.filter((result) => result.success).length;
      const stationaryCategories = new Set(stationaryResults.filter((result) => result.success).map((result) => result.category));

      await testInfo.attach('camera-sky-look-results.json', {
        body: JSON.stringify({ stationarySuccessCount, smoothSuccessCount, preserveSuccessCount, stationaryResults, smoothResults, preserveResults }, null, 2),
        contentType: 'application/json',
      });

      expect(stationarySuccessCount, JSON.stringify(stationaryResults, null, 2)).toBeGreaterThanOrEqual(REQUIRED_STATIONARY_SUCCESS_COUNT);
      expect(smoothSuccessCount, JSON.stringify(smoothResults, null, 2)).toBeGreaterThanOrEqual(REQUIRED_SMOOTH_SUCCESS_COUNT);
      expect(preserveSuccessCount, JSON.stringify(preserveResults, null, 2)).toBeGreaterThanOrEqual(REQUIRED_W_PRESERVE_SUCCESS_COUNT);
      expect(stationaryCategories.has('house'), 'house stationary cases should pass').toBe(true);
      expect(stationaryCategories.has('city-wall'), '城墙 stationary cases should pass').toBe(true);
      expect(stationaryCategories.has('mountain'), 'mountain stationary cases should pass').toBe(true);
    } finally {
      await testInfo.attach('camera-sky-look-results-final.json', {
        body: JSON.stringify({ activeGameId, stationaryResults, smoothResults, preserveResults }, null, 2),
        contentType: 'application/json',
      }).catch(() => undefined);
      if (activeGameId) await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId: activeGameId } }).catch(() => undefined);
      await hostContext.close();
      await guestContext.close();
    }
  });
});
