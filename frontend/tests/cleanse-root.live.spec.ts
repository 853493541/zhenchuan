import { expect, test, type Page, type TestInfo } from '@playwright/test';

const primaryUsername = process.env.ZHENCHUAN_TEST_USERNAME;
const primaryPassword = process.env.ZHENCHUAN_TEST_PASSWORD;
const secondUsername = process.env.ZHENCHUAN_SECOND_TEST_USERNAME;
const secondPassword = process.env.ZHENCHUAN_SECOND_TEST_PASSWORD;

const LIVE_BASE_URL = 'https://zhenchuan.renstoolbox.com';

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

function makeTemporaryCredentials(label: string): LoginCredentials {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return {
    username: `cleanse_${label}_${unique}`,
    password: `cleanse-${unique}-${Math.random().toString(36).slice(2, 10)}`,
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

async function login(page: Page, baseUrl: string, username: string, password: string) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('用户名').fill(username);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 });
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
  await page.goto(`${baseUrl}/game/in-game?gameId=${gameId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('canvas')).some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = window.getComputedStyle(canvas);
      return rect.width >= 200 && rect.height >= 200 && style.display !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 90_000 });
}

async function clearBuffs(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/clear-buffs`, { data: { gameId }, timeout: 10_000 });
  expect(res.ok()).toBeTruthy();
}

async function resetCooldowns(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/reset-cooldowns`, { data: { gameId }, timeout: 10_000 });
  expect(res.ok()).toBeTruthy();
}

async function setPlayerPositions(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/set-player-positions`, {
    data: {
      gameId,
      positions: [
        { playerIndex: 0, x: 280, y: 426, faceTargetX: 284, faceTargetY: 426 },
        { playerIndex: 1, x: 284, y: 426, faceTargetX: 280, faceTargetY: 426 },
      ],
    },
    timeout: 10_000,
  });
  expect(res.ok()).toBeTruthy();
}

async function addAbility(page: Page, baseUrl: string, gameId: string, abilityId: string) {
  const res = await page.request.post(`${baseUrl}/api/game/cheat/add-ability`, {
    data: { gameId, abilityId },
    timeout: 10_000,
  });
  const bodyText = await res.text();
  expect(res.ok(), `add-ability failed for ${abilityId}: ${bodyText}`).toBeTruthy();
}

async function getSnapshot(page: Page, baseUrl: string, gameId: string) {
  const res = await page.request.get(`${baseUrl}/api/game/${gameId}`, { timeout: 15_000 });
  const bodyText = await res.text();
  expect(res.ok(), `snapshot failed: ${res.status()} ${bodyText.slice(0, 500)}`).toBeTruthy();
  return JSON.parse(bodyText);
}

function hasRootDebuff(player: any) {
  const buffs = Array.isArray(player?.buffs) ? player.buffs : [];
  return buffs.some((buff: any) => Array.isArray(buff?.effects) && buff.effects.some((effect: any) => effect?.type === 'ROOT'));
}

function getBuffNames(player: any) {
  const buffs = Array.isArray(player?.buffs) ? player.buffs : [];
  return buffs.map((buff: any) => String(buff?.name ?? buff?.buffId ?? 'unknown'));
}

async function waitUntil(page: Page, condition: () => Promise<boolean>, timeoutMs: number, pollMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await page.waitForTimeout(pollMs);
  }
  return false;
}

async function getAbilityInstanceIdForPlayer(page: Page, baseUrl: string, gameId: string, playerIndex: number, abilityId: string) {
  const snapshot = await getSnapshot(page, baseUrl, gameId);
  const hand = snapshot?.state?.players?.[playerIndex]?.hand ?? [];
  const ability = Array.isArray(hand) ? hand.find((entry: any) => entry?.abilityId === abilityId) : null;
  expect(ability?.instanceId, `missing ${abilityId} in player ${playerIndex} hand`).toBeTruthy();
  return String(ability.instanceId);
}

async function castAbility(page: Page, baseUrl: string, gameId: string, abilityInstanceId: string, targetUserId?: string) {
  const res = await page.request.post(`${baseUrl}/api/game/play`, {
    data: {
      gameId,
      abilityInstanceId,
      movementIntent: false,
      ...(targetUserId ? { targetUserId } : {}),
    },
    timeout: 10_000,
  });
  const text = await res.text();
  expect(res.ok(), `cast failed (${abilityInstanceId}): ${res.status()} ${text.slice(0, 500)}`).toBeTruthy();
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.describe('live root cleanse verification', () => {

  test('on-screen: 星楼月影 and 游风飘踪 both remove ROOT', async ({ browser }, testInfo) => {
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

      gameId = await createCollisionTestBattle(host, guest, baseUrl);
      await waitForBattleCanvas(host, baseUrl, gameId);

      await setPlayerPositions(host, baseUrl, gameId);
      await clearBuffs(host, baseUrl, gameId);
      await resetCooldowns(host, baseUrl, gameId);

      await addAbility(guest, baseUrl, gameId, 'san_cai_hua_sheng');
      await addAbility(host, baseUrl, gameId, 'xinglou_yueying');
      await addAbility(host, baseUrl, gameId, 'you_feng_piao_zong');

      const rootCastId = await getAbilityInstanceIdForPlayer(host, baseUrl, gameId, 1, 'san_cai_hua_sheng');
      const xinglouCastId = await getAbilityInstanceIdForPlayer(host, baseUrl, gameId, 0, 'xinglou_yueying');
      const youfengCastId = await getAbilityInstanceIdForPlayer(host, baseUrl, gameId, 0, 'you_feng_piao_zong');

      const hostUserId = String((await getSnapshot(host, baseUrl, gameId))?.state?.players?.[0]?.userId ?? '');
      expect(hostUserId.length).toBeGreaterThan(0);

      await castAbility(guest, baseUrl, gameId, rootCastId);
      const rootedBeforeXinglou = await waitUntil(host, async () => {
        const snapshot = await getSnapshot(host, baseUrl, gameId!);
        return hasRootDebuff(snapshot?.state?.players?.[0]);
      }, 8_000);
      expect(rootedBeforeXinglou, 'host should be rooted before 星楼月影').toBe(true);
      await host.screenshot({ path: testInfo.outputPath('root-before-xinglou.png') });

      await resetCooldowns(host, baseUrl, gameId);
      await castAbility(host, baseUrl, gameId, xinglouCastId, hostUserId);

      const rootClearedByXinglou = await waitUntil(host, async () => {
        const snapshot = await getSnapshot(host, baseUrl, gameId!);
        return !hasRootDebuff(snapshot?.state?.players?.[0]);
      }, 8_000);
      const afterXinglouSnapshot = await getSnapshot(host, baseUrl, gameId);
      await host.screenshot({ path: testInfo.outputPath('after-xinglou.png') });

      await clearBuffs(host, baseUrl, gameId);
      await resetCooldowns(host, baseUrl, gameId);
      await setPlayerPositions(host, baseUrl, gameId);

      await castAbility(guest, baseUrl, gameId, rootCastId);
      const rootedBeforeYoufeng = await waitUntil(host, async () => {
        const snapshot = await getSnapshot(host, baseUrl, gameId!);
        return hasRootDebuff(snapshot?.state?.players?.[0]);
      }, 8_000);
      expect(rootedBeforeYoufeng, 'host should be rooted before 游风飘踪').toBe(true);

      await resetCooldowns(host, baseUrl, gameId);
      await castAbility(host, baseUrl, gameId, youfengCastId, hostUserId);

      const rootClearedByYoufeng = await waitUntil(host, async () => {
        const snapshot = await getSnapshot(host, baseUrl, gameId!);
        return !hasRootDebuff(snapshot?.state?.players?.[0]);
      }, 8_000);
      const afterYoufengSnapshot = await getSnapshot(host, baseUrl, gameId);
      await host.screenshot({ path: testInfo.outputPath('after-youfeng.png') });

      await testInfo.attach('cleanse-root-live-diagnostics.json', {
        body: JSON.stringify({
          gameId,
          rootedBeforeXinglou,
          rootClearedByXinglou,
          rootedBeforeYoufeng,
          rootClearedByYoufeng,
          hostBuffsAfterXinglou: getBuffNames(afterXinglouSnapshot?.state?.players?.[0]),
          hostBuffsAfterYoufeng: getBuffNames(afterYoufengSnapshot?.state?.players?.[0]),
        }, null, 2),
        contentType: 'application/json',
      });

      expect(rootClearedByXinglou, '星楼月影 should remove ROOT').toBe(true);
      expect(rootClearedByYoufeng, '游风飘踪 should remove ROOT').toBe(true);
    } finally {
      if (gameId) {
        await host.request.post(`${baseUrl}/api/game/end`, { data: { gameId }, timeout: 5_000 }).catch(() => undefined);
      }
      await hostContext.close();
      await guestContext.close();
    }
  });
});
