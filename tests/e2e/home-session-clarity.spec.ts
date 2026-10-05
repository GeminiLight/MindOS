import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

async function openChineseHome(page: Page, context: BrowserContext, baseURL: string, theme: 'light' | 'dark' = 'light') {
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL }]);
  await page.addInitScript(themeName => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', themeName); }, theme);
  await page.goto('/');
}

async function paintedAlpha(locator: Locator, pseudo?: string): Promise<number> {
  return locator.evaluate((element, pseudoElement) => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = getComputedStyle(element, pseudoElement || null).color;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] / 255;
  }, pseudo);
}

test('Home keeps the current conversation label readable', async ({ page, context, baseURL }) => {
  await openChineseHome(page, context, baseURL!);
  const title = page.locator('[data-ask-header]').getByText('新对话', { exact: true });
  await expect(title).toBeVisible();
  expect(await paintedAlpha(title)).toBeGreaterThanOrEqual(0.9);
});

test('Home session search is readable without a square double focus outline', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChineseHome(page, context, baseURL!);
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const input = page.locator('[data-home-session-search-input]');
  await expect(input).toBeVisible();
  await input.click();
  await expect(input).toBeFocused();

  const styles = await input.evaluate(element => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    containerRadius: Number.parseFloat(getComputedStyle(element.parentElement!).borderTopLeftRadius),
  }));
  expect(styles.outlineStyle).toBe('none');
  expect(styles.fontSize).toBeGreaterThanOrEqual(14);
  expect(styles.containerRadius).toBeGreaterThanOrEqual(8);
  expect(await paintedAlpha(input, '::placeholder')).toBeGreaterThanOrEqual(0.9);
  await page.screenshot({ path: '/tmp/mindos-home-session-search-focus-zh.png', animations: 'disabled' });
});

test('Home distinguishes an empty Agent filter from a search miss', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/agent/sessions', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: [{
      id: 'sample-mind-session', title: '今日复盘', createdAt: 1_000, updatedAt: 2_000,
      messages: [{ role: 'user', content: '今天的判断哪里需要改进？' }],
    }] });
  });
  await openChineseHome(page, context, baseURL!);
  await expect(page.locator('[data-home-session-row="sample-mind-session"]')).toBeVisible();

  await page.locator('[data-home-agent-filter="codex"]').click();
  await expect(page.locator('[data-home-agent-empty]')).toContainText('Codex 暂无会话');
  await expect(page.locator('[data-home-session-search-empty]')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/mindos-home-agent-empty-zh.png', animations: 'disabled' });

  await page.locator('[data-home-agent-show-all]').click();
  await expect(page.locator('[data-home-session-row="sample-mind-session"]')).toBeVisible();
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  await page.locator('[data-home-session-search-input]').fill('不存在的会话');
  await expect(page.locator('[data-home-session-search-empty]')).toContainText('没有匹配的会话');
  await expect(page.locator('[data-home-agent-empty]')).toHaveCount(0);
});

test('narrow desktop search keeps the input and clear action readable in dark mode', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 800, height: 844 });
  await openChineseHome(page, context, baseURL!, 'dark');
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const input = page.locator('[data-home-session-search-input]');
  await expect(input).toBeVisible();
  await input.fill('很长的中文查询');
  const styles = await input.evaluate(element => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
  }));
  expect(styles.outlineStyle).toBe('none');
  expect(styles.fontSize).toBeGreaterThanOrEqual(14);
  expect(await paintedAlpha(input, '::placeholder')).toBeGreaterThanOrEqual(0.9);
  expect(await input.getAttribute('type')).toBe('text');
  await expect(input).toHaveAttribute('role', 'searchbox');
  await expect(page.getByRole('button', { name: '清空会话搜索' })).toBeVisible();
  await page.getByRole('button', { name: '清空会话搜索' }).click();
  await expect(input).toHaveCount(0);
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  await input.fill('很长的中文查询');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-home-session-search-dark-800.png', animations: 'disabled' });
});
