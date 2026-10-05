import { expect, test } from '@playwright/test';

test('Explore opens a reviewable prompt and keeps one task list instead of duplicating sidebar launchers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore');

  await expect(page.getByRole('heading', { name: 'Start with a task' })).toBeVisible();
  await expect(page.locator('[data-explore-task]')).toHaveCount(9);
  await expect(page.getByRole('button', { name: 'Try it' })).toHaveCount(0);
  await expect(page.getByText('review before sending')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Task starters', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: '/tmp/mindos-explore-task-default-desktop.png', animations: 'disabled' });

  await page.getByRole('button', { name: 'Edit prompt' }).first().click();
  await expect(page.locator('textarea').first()).toHaveValue(/Help me write a profile/);
  await expect(page.getByText('Start with a task')).toBeVisible();
  await page.screenshot({ path: '/tmp/mindos-explore-task-desktop.png', animations: 'disabled' });
});

test('scenario and optional capability filters handle an empty intersection with a reset', async ({ page }) => {
  await page.goto('/explore');
  const tasks = page.locator('[data-explore-task]');
  await page.getByRole('button', { name: 'Daily Work' }).click();
  await expect(tasks).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Daily Work' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByText('By Capability').click();
  await page.getByRole('button', { name: 'Audit & Control' }).click();
  await expect(tasks).toHaveCount(0);
  await expect(page.getByText('No tasks match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(tasks).toHaveCount(9);
  await page.getByRole('button', { name: 'All', exact: true }).first().click();
  await page.keyboard.press('Tab');
  const firstDay = page.getByRole('button', { name: 'First Day' });
  await expect(firstDay).toBeFocused();
  expect(await firstDay.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
});

test('choosing another task protects an unfinished Ask draft until the user replaces it', async ({ page }) => {
  await page.goto('/explore');
  const actions = page.locator('[data-explore-task]').getByRole('button', { name: 'Edit prompt' });
  await actions.first().click();
  const input = page.locator('textarea').first();
  await input.fill('My unfinished thought');
  await actions.nth(1).click();
  await expect(input).toHaveValue('My unfinished thought');
  await expect(page.getByText('You have an unfinished draft')).toBeVisible();
  await page.getByRole('button', { name: 'Keep my draft' }).click();
  await expect(input).toHaveValue('My unfinished thought');
  await actions.nth(1).click();
  await page.getByRole('button', { name: 'Use new prompt' }).click();
  await expect(input).toHaveValue(/Help me capture a source/);
});

test('Chinese mobile task list keeps readable copy and touch-sized actions without horizontal overflow', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', 'dark'); });
  await page.goto('/explore');

  await expect(page.getByRole('heading', { name: '从一件事开始' })).toBeVisible();
  await expect(page.locator('[data-explore-task]')).toHaveCount(9);
  const draftAction = page.getByRole('button', { name: '编辑提问草稿' }).first();
  await expect(draftAction).toBeVisible();
  expect((await draftAction.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole('button', { name: '日常工作' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-explore-task-mobile-zh.png', animations: 'disabled' });
});

test('Chinese mobile Discover overview uses the same task language and stays within the viewport', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', 'dark'); });
  await page.goto('/explore/capabilities', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('link', { name: /任务入口/ }).first()).toBeVisible();
  await expect(page.getByText('选择任务，编辑提问草稿后再发送。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-explore-overview-mobile-zh.png', animations: 'disabled' });
});
