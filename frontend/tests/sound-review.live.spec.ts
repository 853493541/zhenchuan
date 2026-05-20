import { expect, test } from '@playwright/test';

const username = process.env.ZHENCHUAN_TEST_USERNAME;
const password = process.env.ZHENCHUAN_TEST_PASSWORD;

test.describe('live sound review tab', () => {
  test.skip(!username || !password, 'Requires ZHENCHUAN_TEST_USERNAME and ZHENCHUAN_TEST_PASSWORD');

  test('shows grouped sound rows and review actions on the live site', async ({ page }, testInfo) => {
    const baseUrl = (testInfo.project.use.baseURL as string | undefined) ?? 'https://zhenchuan.renstoolbox.com';

    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('用户名').fill(username!);
    await page.getByPlaceholder('密码').fill(password!);
    await page.getByRole('button', { name: '登录' }).click();

    await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 });
    await page.goto(`${baseUrl}/ability-editor?tab=soundReview`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('能力属性与AD倍率编辑')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '音效审核' })).toBeVisible();
    await expect(page.getByText(/筛选 ·/)).toBeVisible();
    await expect(page.getByText(/需要继续处理 \(/)).toBeVisible();
    await expect(page.getByText(/未决定 \(/)).toBeVisible();
    await expect(page.getByText(/音效可用 \(/)).toBeVisible();
    await expect(page.getByRole('button', { name: '需要继续处理' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '音效可用' }).first()).toBeVisible();

    const boardBox = await page.locator('#sound-review-board').boundingBox();
    expect(boardBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(180);

    await page.screenshot({ path: testInfo.outputPath('sound-review-live.png'), fullPage: true });

    await page.setViewportSize({ width: 650, height: 1400 });
    await page.goto(`${baseUrl}/sound-browser`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/ability-editor\?tab=soundReview/);
    await expect(page.getByText('能力属性与AD倍率编辑')).toHaveCount(0);
    await expect(page.getByText(/筛选 ·/)).toBeVisible();
    await expect(page.getByText(/需要继续处理 \(/)).toBeVisible();
    await expect(page.getByText(/未决定 \(/)).toBeVisible();
    await expect(page.getByText(/音效可用 \(/)).toBeVisible();

    const mobileBoardBox = await page.locator('#sound-review-board').boundingBox();
    expect(mobileBoardBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(160);

    await page.screenshot({ path: testInfo.outputPath('sound-review-live-mobile.png'), fullPage: false });
  });
});