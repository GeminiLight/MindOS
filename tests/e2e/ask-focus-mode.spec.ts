import { expect, test, type Page } from '@playwright/test';

async function openFocusMode(page: Page, locale: 'en' | 'zh' = 'en') {
  await page.goto('/capture');
  await page.getByRole('button', { name: locale === 'zh' ? /问 MindOS/ : /Ask MindOS/ }).click();
  const panel = page.getByRole('complementary', { name: 'MindOS panel' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: locale === 'zh' ? '专注模式' : 'Focus mode' }).click();
  await expect(panel.getByRole('button', { name: locale === 'zh' ? '退出专注' : 'Exit focus' })).toBeVisible();
  await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(page.viewportSize()!.width - 400);
  return panel;
}

test('focus mode centers a readable chat column and restores the draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = await openFocusMode(page);
  await panel.getByRole('button', { name: 'New session' }).click();
  await expect(panel.getByText('How can I help?')).toBeVisible();
  const input = panel.locator('textarea.ask-composer-input');
  await input.fill('A thought to continue after focus mode');

  const metrics = await panel.evaluate(element => {
    const panelBounds = element.getBoundingClientRect();
    const headerBounds = element.querySelector('[data-ask-header]')!.getBoundingClientRect();
    const composerBounds = element.querySelector('.ask-composer-card')!.getBoundingClientRect();
    const logBounds = element.querySelector('[role="log"]')!.getBoundingClientRect();
    const promptBounds = Array.from(element.querySelectorAll('p')).find(p => p.textContent === 'How can I help?')!.getBoundingClientRect();
    return {
      panelLeft: panelBounds.left,
      panelRight: panelBounds.right,
      panelTop: panelBounds.top,
      panelBottom: panelBounds.bottom,
      leftOffset: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-left-offset')),
      titlebarHeight: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-titlebar-h')),
      panelRadius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
      panelWidth: panelBounds.width,
      headerWidth: headerBounds.width,
      composerWidth: composerBounds.width,
      headerOffset: Math.abs((headerBounds.left + headerBounds.right) / 2 - (panelBounds.left + panelBounds.right) / 2),
      composerOffset: Math.abs((composerBounds.left + composerBounds.right) / 2 - (panelBounds.left + panelBounds.right) / 2),
      promptPosition: ((promptBounds.top + promptBounds.bottom) / 2 - logBounds.top) / logBounds.height,
      panelShadow: getComputedStyle(element).boxShadow,
    };
  });
  expect(metrics.panelWidth).toBeGreaterThan(1000);
  expect(metrics.panelLeft).toBeGreaterThan(metrics.leftOffset + 8);
  expect(metrics.panelRight).toBeLessThan(1440 - 8);
  expect(metrics.panelTop).toBeGreaterThan(metrics.titlebarHeight + 8);
  expect(metrics.panelBottom).toBeLessThan(900 - 8);
  expect(metrics.panelRadius).toBeGreaterThanOrEqual(11);
  expect(metrics.headerWidth).toBeLessThanOrEqual(840);
  expect(metrics.composerWidth).toBeLessThanOrEqual(840);
  expect(metrics.headerOffset).toBeLessThan(3);
  expect(metrics.composerOffset).toBeLessThan(3);
  expect(metrics.promptPosition).toBeGreaterThan(0.25);
  expect(metrics.promptPosition).toBeLessThan(0.7);
  expect(metrics.panelShadow).not.toContain('25px 50px');
  await page.screenshot({ path: '/tmp/mindos-ask-focus-mode-desktop.png', animations: 'disabled' });

  await panel.getByRole('button', { name: 'Exit focus' }).click();
  await expect(panel.getByRole('button', { name: 'Focus mode' })).toBeVisible();
  await expect(input).toHaveValue('A thought to continue after focus mode');
  await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(500);
});

test('focus mode stays usable on a narrow desktop and Escape restores docking', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const panel = await openFocusMode(page);
  await panel.getByRole('button', { name: 'New session' }).click();
  await expect(panel.getByText('How can I help?')).toBeVisible();
  const composer = panel.locator('.ask-composer-card');
  await expect(composer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const panelBox = await panel.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(panelBox && composerBox && composerBox.x >= panelBox.x && composerBox.x + composerBox.width <= panelBox.x + panelBox.width + 1).toBe(true);
  const anchor = panel.locator('[role="log"] svg.lucide-sparkles').first().locator('..');
  const anchorBox = await anchor.boundingBox();
  const logBox = await panel.getByRole('log').boundingBox();
  expect(anchorBox?.width).toBeGreaterThanOrEqual(44);
  expect(anchorBox?.height).toBeGreaterThanOrEqual(44);
  expect(anchorBox && logBox && anchorBox.y >= logBox.y + 4).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-ask-focus-mode-narrow.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Focus mode' })).toBeVisible();
});

test('an existing conversation stays inside the reading column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/agent/sessions', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: [{
      id: 'focus-reading-sample',
      title: 'Focus reading sample',
      source: 'quick',
      createdAt: 1_000,
      updatedAt: 2_000,
      messages: [
        { role: 'user', content: 'How should we make this explanation easier to read?', timestamp: 1_000 },
        { role: 'assistant', content: 'A long answer should stay within a comfortable reading column. '.repeat(16), timestamp: 2_000 },
      ],
    }] });
  });
  const panel = await openFocusMode(page);
  await expect(panel.getByText(/A long answer should stay/)).toBeVisible();
  const row = panel.getByRole('log').locator(':scope > div').first();
  const panelBox = await panel.boundingBox();
  const rowBox = await row.boundingBox();
  expect(rowBox?.width).toBeLessThanOrEqual(840);
  expect(panelBox && rowBox && Math.abs(rowBox.x + rowBox.width / 2 - (panelBox.x + panelBox.width / 2)) < 4).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-ask-focus-mode-conversation.png', animations: 'disabled' });
});

test('history opened from focus mode keeps the same reading width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = await openFocusMode(page);
  await panel.getByRole('button', { name: 'Session history' }).click();
  const history = panel.locator('[aria-busy]').first();
  await expect(history).toBeVisible();
  const historyBox = await history.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(historyBox?.width).toBeLessThanOrEqual(840);
  expect(historyBox && panelBox && Math.abs(historyBox.x + historyBox.width / 2 - (panelBox.x + panelBox.width / 2)) < 4).toBe(true);
  const search = history.getByRole('searchbox', { name: 'Search conversations' });
  await expect(search).toBeFocused();
  const searchStyle = await search.evaluate(element => ({
    outline: getComputedStyle(element).outlineStyle,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(searchStyle.outline).toBe('none');
  expect(searchStyle.fontSize).toBeGreaterThanOrEqual(14);
  expect(searchStyle.radius).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: '/tmp/mindos-ask-focus-mode-history.png', animations: 'disabled' });
});

test('Chinese dark focus mode keeps the quiet reading layout', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', 'dark'); });
  const panel = await openFocusMode(page, 'zh');
  // The panel expands for 200ms; compare positions after the layout settles.
  await expect.poll(async () => {
    const panelBox = await panel.boundingBox();
    const cardBox = await panel.locator('.ask-composer-card').boundingBox();
    if (!panelBox || !cardBox || cardBox.width > 840) return Infinity;
    return Math.abs(cardBox.x + cardBox.width / 2 - (panelBox.x + panelBox.width / 2));
  }).toBeLessThan(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-ask-focus-mode-dark-zh.png', animations: 'disabled' });
});

test('a direct conversation page keeps its composer inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat/new');
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  const shell = page.locator('[data-home-focus-shell]');
  const composer = shell.locator('.ask-composer-card');
  await expect(composer).toBeVisible();
  await expect.poll(async () => {
    const shellBox = await shell.boundingBox();
    const composerBox = await composer.boundingBox();
    return Boolean(shellBox && shellBox.y >= 53 && shellBox.y + shellBox.height <= 836
      && composerBox && composerBox.y + composerBox.height <= 832);
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-direct-chat-mobile-focus.png', animations: 'disabled' });
});
