import { expect, test } from '@playwright/test';

test('Agents keeps one visible section navigation on desktop and restores it when the sidebar closes', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addCookies([{ name: 'locale', value: 'en', url: baseURL! }]);
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  const mainNav = page.locator('.agents-content-page nav[aria-label="Agent workbench sections"]');
  const panel = page.getByRole('region', { name: 'agents panel' });
  await expect(panel.getByRole('navigation', { name: 'Agents' })).toBeVisible();
  await expect(mainNav).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
  await page.screenshot({ path: '/tmp/mindos-agents-nav-desktop-open.png', animations: 'disabled' });

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(mainNav).toBeVisible();
  await expect(mainNav.getByRole('link', { name: 'Agent', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/mindos-agents-nav-desktop-collapsed.png', animations: 'disabled' });
});

test('Agents keeps section navigation in the content on a phone', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => localStorage.setItem('locale', 'zh'));
  await page.goto('/agents?tab=agent');
  const mainNav = page.locator('.agents-content-page nav[aria-label="Agent 工作台分区"]');
  await expect(mainNav).toBeVisible();
  await expect(mainNav.getByRole('link', { name: 'Agent', exact: true })).toHaveAttribute('aria-current', 'page');
  const smallestTarget = await mainNav.getByRole('link').evaluateAll(links => Math.min(...links.map(link => link.getBoundingClientRect().height)));
  expect(smallestTarget).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-agents-nav-mobile-zh.png', animations: 'disabled' });
});

test('Agents section links survive a connection-status failure when the sidebar is closed', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await context.addCookies([{ name: 'locale', value: 'en', url: baseURL! }]);
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  await page.route('**/api/mcp/status', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto('/agents?tab=assistant');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  const mainNav = page.locator('.agents-content-page nav[aria-label="Agent workbench sections"]');
  await expect(mainNav).toBeVisible();
  await expect(mainNav.getByRole('link', { name: 'Assistant' })).toHaveAttribute('aria-current', 'page');
});
