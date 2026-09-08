import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

async function openMenu(page: Page) {
  // An open modal correctly removes the background trigger from the a11y tree.
  const trigger = page.locator('header button[aria-haspopup="dialog"]');
  // Development hydration can finish after the first visible frame.
  await expect.poll(async () => {
    if (await trigger.getAttribute('aria-expanded') === 'true') return true;
    await trigger.click();
    return await trigger.getAttribute('aria-expanded') === 'true';
  }).toBe(true);
  await expect(page.getByRole('button', { name: 'Close menu', exact: true })).toBeFocused();
  await expect.poll(async () => Math.round((await page.getByRole('dialog', { name: 'MindOS menu' }).boundingBox())!.x)).toBe(0);
  return trigger;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  // These are navigation checks: never send a model run or mutate real settings.
  await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
    ? route.fallback() : route.fulfill({ json: { ok: true } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('contains forward and backward keyboard focus until dismissed', async ({ page }) => {
  const trigger = await openMenu(page);
  const dialog = page.getByRole('dialog', { name: 'MindOS menu' });
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key);
      await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('releases the page when an open drawer crosses the desktop breakpoint', async ({ page }) => {
  await openMenu(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const main = page.locator('#main-content');
  await expect.poll(() => main.evaluate(node => node.inert || !!node.closest('[inert]'))).toBe(false);
  await expect(main).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('dialog', { name: 'MindOS menu' })).not.toBeVisible();
  await expect(main).toBeFocused();
  await page.screenshot({ path: '/tmp/ui-craft-drawer-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
  await openMenu(page);
});

test('offers a comfortable close target and returns focus after closing', async ({ page }) => {
  const trigger = await openMenu(page);
  const close = page.getByRole('button', { name: 'Close menu', exact: true });
  const bounds = await close.boundingBox();
  await page.screenshot({ path: '/tmp/ui-craft-drawer-mobile.png' });
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'MindOS menu' })).not.toBeVisible();
});

test('makes the main work destinations available in the mobile menu', async ({ page }) => {
  await openMenu(page);
  const dialog = page.getByRole('dialog', { name: 'MindOS menu' });
  for (const href of ['/capture', '/wiki', '/studio', '/echo/overview', '/agents', '/explore']) {
    await expect(dialog.locator(`a[href="${href}"]`)).toBeVisible();
  }
  await dialog.locator('a[href="/capture"]').click();
  await expect(page).toHaveURL(/\/capture$/);
  await expect(dialog).not.toBeVisible();
  await openMenu(page);
  await expect(dialog.locator('a[href="/capture"]')).toHaveAttribute('aria-current', 'page');
});
