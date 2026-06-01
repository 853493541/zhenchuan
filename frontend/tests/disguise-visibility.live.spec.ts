import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { inflateSync } from 'node:zlib';

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';
const DISGUISE_CONSUMABLE_ID = 'sha_shi_wei_zhuang';
const DISGUISE_BUFF_ID = 980001;

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type LoginCredentials = { username: string; password: string };

function getLiveBaseUrl(testInfo: TestInfo) {
  const configured = testInfo.project.use.baseURL as string | undefined;
  if (process.env.PLAYWRIGHT_BASE_URL) return process.env.PLAYWRIGHT_BASE_URL;
  if (configured && !configured.includes('127.0.0.1') && !configured.includes('localhost')) return configured;
  return LIVE_BASE_URL;
}

function makeTemporaryCredentials(label: string): LoginCredentials {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return {
    username: `disguise_${label}_${unique}`,
    password: `disguise-${label}-${unique}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

async function createTemporaryUser(page: Page, baseUrl: string, label: string): Promise<LoginCredentials> {
  const credentials = makeTemporaryCredentials(label);
  const res = await page.request.post(`${baseUrl}/api/auth/bootstrap`, { data: credentials });
  expect(res.ok(), `bootstrap ${label} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return credentials;
}

async function login(page: Page, baseUrl: string, credentials: LoginCredentials) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('用户名').fill(credentials.username);
  await page.getByPlaceholder('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 });
}

async function postJson(page: Page, baseUrl: string, path: string, data: unknown) {
  const res = await page.request.post(`${baseUrl}${path}`, { data, timeout: 30_000 });
  const text = await res.text();
  expect(res.ok(), `${path} failed: ${res.status()} ${text.slice(0, 1000)}`).toBeTruthy();
  try { return JSON.parse(text); } catch { return text; }
}

async function getSnapshot(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 30_000 });
  const text = await res.text();
  expect(res.ok(), `snapshot failed: ${res.status()} ${text.slice(0, 1000)}`).toBeTruthy();
  return JSON.parse(text);
}

async function createBattle(host: Page, guest: Page, baseUrl: string) {
  const created = await postJson(host, baseUrl, '/api/game/create', { mode: 'collision-test' });
  const gameId = String(created._id);
  await postJson(guest, baseUrl, `/api/game/join/${gameId}`, {});
  await postJson(host, baseUrl, '/api/game/start', { gameId });
  return gameId;
}

async function waitForBattlePage(page: Page, baseUrl: string, gameId: string) {
  await page.goto(`${baseUrl}/game/in-game?gameId=${gameId}&playwrightCameraSkyProbe=1&playwrightDisguiseProbe=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('canvas')).some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return rect.width >= 200 && rect.height >= 200;
    });
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => typeof (window as any).__zhenchuanSetCameraForProbe === 'function', undefined, { timeout: 30_000 });
}

async function waitForCharacterProbe(page: Page, userId: string, predicate: (entry: any) => boolean) {
  await page.waitForFunction(
    ({ targetUserId }) => {
      const entry = (window as any).__zhenchuanDisguiseProbe?.characters?.[targetUserId];
      return !!entry;
    },
    { targetUserId: userId },
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    ({ targetUserId, predicateSource }) => {
      const entry = (window as any).__zhenchuanDisguiseProbe?.characters?.[targetUserId];
      const fn = new Function('entry', `return (${predicateSource})(entry);`);
      return !!entry && fn(entry);
    },
    { targetUserId: userId, predicateSource: predicate.toString() },
    { timeout: 30_000 },
  );
}

async function aimCameraAtProbedCharacter(page: Page, targetUserId: string) {
  const yawCandidates = [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
  let best: any = null;
  for (const yaw of yawCandidates) {
    await page.evaluate((nextYaw) => (window as any).__zhenchuanSetCameraForProbe?.({ yaw: nextYaw, pitch: -0.22, zoom: 0.85 }), yaw);
    await page.waitForTimeout(350);
    const entry = await page.evaluate((id) => (window as any).__zhenchuanDisguiseProbe?.characters?.[id] ?? null, targetUserId);
    if (!entry) continue;
    const score = (entry.inClip ? 1000 : 0) - Math.abs(entry.screen.x - 640) - Math.abs(entry.screen.y - 380);
    if (!best || score > best.score) best = { yaw, entry, score };
    if (entry.inClip && entry.screen.x > 120 && entry.screen.x < 1160 && entry.screen.y > 80 && entry.screen.y < 720) return { yaw, entry };
  }
  if (best) {
    await page.evaluate((nextYaw) => (window as any).__zhenchuanSetCameraForProbe?.({ yaw: nextYaw, pitch: -0.22, zoom: 0.85 }), best.yaw);
    await page.waitForTimeout(350);
    return best;
  }
  throw new Error('target character never appeared in disguise probe');
}

async function sampleCanvasAroundProbe(page: Page, targetUserId: string) {
  return page.evaluate((id) => {
    const entry = (window as any).__zhenchuanDisguiseProbe?.characters?.[id];
    const canvas = Array.from(document.querySelectorAll('canvas')).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 200 && rect.height >= 200;
    }) as HTMLCanvasElement | undefined;
    if (!entry || !canvas) return { entry, error: !entry ? 'no probe entry' : 'no canvas' };
    const rect = canvas.getBoundingClientRect();
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const context = offscreen.getContext('2d');
    if (!context) return { entry, error: 'no 2d context' };
    context.drawImage(canvas, 0, 0);
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const radius = 95;
    const x0 = Math.max(0, Math.floor((entry.screen.x - radius) * scaleX));
    const y0 = Math.max(0, Math.floor((entry.screen.y - radius) * scaleY));
    const x1 = Math.min(canvas.width, Math.ceil((entry.screen.x + radius) * scaleX));
    const y1 = Math.min(canvas.height, Math.ceil((entry.screen.y + radius) * scaleY));
    const imageData = context.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
    let nonDark = 0;
    let brownish = 0;
    let reddish = 0;
    let alpha = 0;
    const total = imageData.length / 4;
    for (let index = 0; index < imageData.length; index += 4) {
      const red = imageData[index];
      const green = imageData[index + 1];
      const blue = imageData[index + 2];
      const a = imageData[index + 3];
      if (a > 10) alpha += 1;
      if (a > 10 && red + green + blue > 90) nonDark += 1;
      if (a > 10 && red > 70 && green > 40 && green < 165 && blue < 135 && red > blue + 15) brownish += 1;
      if (a > 10 && red > 130 && green < 130 && blue < 130) reddish += 1;
    }
    return {
      entry,
      rect: { width: rect.width, height: rect.height, canvasWidth: canvas.width, canvasHeight: canvas.height },
      sample: { total, alpha, nonDark, brownish, reddish, x0, y0, x1, y1 },
    };
  }, targetUserId);
}

function unfilterPngScanline(filter: number, current: Uint8Array, previous: Uint8Array, bytesPerPixel: number) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] ?? 0 : 0;
    if (filter === 1) current[index] = (current[index] + left) & 0xff;
    else if (filter === 2) current[index] = (current[index] + up) & 0xff;
    else if (filter === 3) current[index] = (current[index] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      current[index] = (current[index] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter ${filter}`);
    }
  }
}

function parsePngRgba(buffer: Buffer) {
  const signature = '89504e470d0a1a0a';
  expect(buffer.subarray(0, 8).toString('hex')).toBe(signature);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      expect(bitDepth, 'Only 8-bit screenshots are supported').toBe(8);
      expect([2, 6].includes(colorType), `Unsupported PNG color type ${colorType}`).toBeTruthy();
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rgba = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    const current = Uint8Array.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilterPngScanline(filter, current, previous, channels);
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = current[source];
      rgba[target + 1] = current[source + 1];
      rgba[target + 2] = current[source + 2];
      rgba[target + 3] = channels === 4 ? current[source + 3] : 255;
    }
    previous = current;
  }
  return { width, height, data: rgba };
}

function samplePngAroundEntry(buffer: Buffer, entry: any) {
  const image = parsePngRgba(buffer);
  const radius = 95;
  const x0 = Math.max(0, Math.floor(entry.screen.x - radius));
  const y0 = Math.max(0, Math.floor(entry.screen.y - radius));
  const x1 = Math.min(image.width, Math.ceil(entry.screen.x + radius));
  const y1 = Math.min(image.height, Math.ceil(entry.screen.y + radius));
  let alpha = 0;
  let nonDark = 0;
  let brownish = 0;
  let reddish = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * image.width + x) * 4;
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      const a = image.data[index + 3];
      if (a > 10) alpha += 1;
      if (a > 10 && red + green + blue > 90) nonDark += 1;
      if (a > 10 && red > 70 && green > 35 && green < 180 && blue < 145 && red > blue + 12) brownish += 1;
      if (a > 10 && red > 130 && green < 130 && blue < 130) reddish += 1;
    }
  }
  return { total: Math.max(0, x1 - x0) * Math.max(0, y1 - y0), alpha, nonDark, brownish, reddish, x0, y0, x1, y1 };
}

test.describe('live disguise visibility', () => {
  test('砂石伪装 is visible to the opponent as a replacement model', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);

    const baseUrl = getLiveBaseUrl(testInfo);
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    let gameId: string | null = null;
    const debug: Record<string, any> = {};

    try {
      const hostCredentials = await createTemporaryUser(host, baseUrl, 'host');
      const guestCredentials = await createTemporaryUser(guest, baseUrl, 'guest');
      await login(host, baseUrl, hostCredentials);
      await login(guest, baseUrl, guestCredentials);

      gameId = await createBattle(host, guest, baseUrl);
      await waitForBattlePage(host, baseUrl, gameId);
      await waitForBattlePage(guest, baseUrl, gameId);

      const initialSnapshot = await getSnapshot(host, baseUrl, gameId);
      const hostUserId = String(initialSnapshot.state.players[0].userId);
      const guestUserId = String(initialSnapshot.state.players[1].userId);
      debug.initialPlayers = initialSnapshot.state.players.map((player: any) => ({ userId: player.userId, position: player.position }));

      await postJson(host, baseUrl, '/api/game/cheat/clear-buffs', { gameId });
      await postJson(host, baseUrl, '/api/game/cheat/refill-consumables', { gameId });
      await postJson(host, baseUrl, '/api/game/cheat/reset-cooldowns', { gameId });
      await postJson(host, baseUrl, '/api/game/cheat/set-player-positions', {
        gameId,
        positions: [
          { playerIndex: 0, x: 260, y: 420, z: 0, faceTargetX: 272, faceTargetY: 420 },
          { playerIndex: 1, x: 272, y: 420, z: 0, faceTargetX: 260, faceTargetY: 420 },
        ],
      });

      await waitForCharacterProbe(guest, hostUserId, (entry: any) => entry.isMe === false);
      debug.beforeProbe = await guest.evaluate((targetUserId) => ({
        probe: (window as any).__zhenchuanDisguiseProbe ?? null,
        target: (window as any).__zhenchuanDisguiseProbe?.characters?.[targetUserId] ?? null,
      }), hostUserId);
      debug.cameraBefore = await aimCameraAtProbedCharacter(guest, hostUserId);
      debug.beforeSample = await sampleCanvasAroundProbe(guest, hostUserId);

      const useResult = await postJson(host, baseUrl, '/api/game/consumable/use', { gameId, consumableId: DISGUISE_CONSUMABLE_ID });
      debug.useResult = useResult;
      await host.waitForTimeout(3500);
      await guest.waitForTimeout(1200);

      const disguisedSnapshot = await getSnapshot(host, baseUrl, gameId);
      const hostState = disguisedSnapshot.state.players.find((player: any) => player.userId === hostUserId);
      const hostBuffs = (hostState?.buffs ?? []).map((buff: any) => ({
        buffId: buff.buffId,
        name: buff.name,
        effects: (buff.effects ?? []).map((effect: any) => effect.type),
        expiresAt: buff.expiresAt,
        durationMs: buff.durationMs,
      }));
      debug.hostBuffsAfterDisguise = hostBuffs;
      expect(hostBuffs.some((buff: any) => buff.buffId === DISGUISE_BUFF_ID && buff.effects.includes('DISGUISE')),
        JSON.stringify(debug, null, 2)).toBe(true);

      await waitForCharacterProbe(guest, hostUserId, (entry: any) => entry.isMe === false);
      debug.afterProbeBeforeAim = await guest.evaluate((targetUserId) => ({
        probe: (window as any).__zhenchuanDisguiseProbe ?? null,
        wsProbe: (window as any).__zhenchuanDisguiseWsProbe ?? null,
        target: (window as any).__zhenchuanDisguiseProbe?.characters?.[targetUserId] ?? null,
      }), hostUserId);
      debug.cameraAfter = await aimCameraAtProbedCharacter(guest, hostUserId);
      debug.afterSample = await sampleCanvasAroundProbe(guest, hostUserId);
      const screenshot = await guest.screenshot({ path: testInfo.outputPath('disguise-opponent-view.png'), fullPage: false });
      debug.afterScreenshotSample = samplePngAroundEntry(screenshot, debug.afterSample.entry);

      await testInfo.attach('disguise-visibility-debug.json', {
        body: JSON.stringify({ ...debug, gameId, hostUserId, guestUserId }, null, 2),
        contentType: 'application/json',
      });

      const afterEntry = debug.afterSample.entry;
      const afterPixels = debug.afterScreenshotSample;
      expect(afterEntry?.isDisguised, JSON.stringify(debug, null, 2)).toBe(true);
      expect(afterEntry?.visibleMeshCount, JSON.stringify(debug, null, 2)).toBeGreaterThan(0);
      expect(afterEntry?.inClip, JSON.stringify(debug, null, 2)).toBe(true);
      expect(afterPixels?.nonDark ?? 0, JSON.stringify(debug, null, 2)).toBeGreaterThan(200);
      expect(afterPixels?.brownish ?? 0, JSON.stringify(debug, null, 2)).toBeGreaterThan(20);
    } finally {
      await testInfo.attach('disguise-visibility-final-debug.json', {
        body: JSON.stringify({ ...debug, gameId }, null, 2),
        contentType: 'application/json',
      }).catch(() => undefined);
      if (gameId) await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId } }).catch(() => undefined);
      await hostContext.close();
      await guestContext.close();
    }
  });
});
