import { expect, test } from '@playwright/test';

test('desktop capture makes saving immediate and reveals batching only when writing another note', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/capture');
  const input = page.locator('#inbox-capture-input');
  await expect(input).toBeVisible();
  await expect(page.locator('[data-stage-note-action]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save to Inbox' })).toBeDisabled();
  await page.screenshot({ path: '/tmp/mindos-capture-empty-desktop.png', animations: 'disabled' });

  await input.fill('First research note');
  const another = page.getByRole('button', { name: 'Write another' });
  await expect(another).toBeVisible();
  await expect(another).toHaveAttribute('aria-description', /Keep this note/);
  await expect(page.getByRole('button', { name: 'Save to Inbox' })).toBeEnabled();
  await page.screenshot({ path: '/tmp/mindos-capture-single-note-desktop.png', animations: 'disabled' });

  await another.click();
  await expect(input).toBeEmpty();
  await expect(input).toBeFocused();
  await expect(page.locator('[data-stage-note-action]')).toHaveCount(0);
  await expect(page.getByText('First research note')).toBeVisible();
  await input.fill('Second research note');
  await expect(input).toHaveValue('Second research note');
  await expect(page.getByText('First research note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save 2 to Inbox' })).toBeEnabled();
  await page.screenshot({ path: '/tmp/mindos-capture-batch-desktop.png', animations: 'disabled' });
});

test('Chinese mobile capture preserves the same direct save and write-another path', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', 'dark'); });
  await page.goto('/capture');
  const input = page.locator('#inbox-capture-input');
  await expect(input).toBeVisible();
  await expect(page.locator('[data-stage-note-action]')).toHaveCount(0);
  await input.fill('第一条研究观察 🌱');
  await expect(page.getByRole('button', { name: '再写一条' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存到收集箱' })).toBeEnabled();
  await page.screenshot({ path: '/tmp/mindos-capture-single-note-mobile-zh.png', animations: 'disabled' });
  await page.getByRole('button', { name: '再写一条' }).click();
  await expect(input).toBeEmpty();
  await expect(input).toBeFocused();
  await input.fill('第二条研究观察');
  await expect(input).toHaveValue('第二条研究观察');
  await expect(page.getByText('第一条研究观察 🌱')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存 2 条到收集箱' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-capture-batch-mobile-zh.png', animations: 'disabled' });
});

test('failed direct save keeps the note editable and its write-another option available', async ({ page }) => {
  await page.route('**/api/inbox**', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } })
    : route.continue());
  await page.goto('/capture');
  const input = page.locator('#inbox-capture-input');
  await expect(input).toBeVisible();
  await input.fill('Keep this note after a failed save');
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect(input).toHaveValue('Keep this note after a failed save');
  await expect(page.getByRole('button', { name: 'Write another' })).toBeEnabled();
});
