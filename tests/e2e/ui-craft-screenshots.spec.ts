import { test, expect } from '@playwright/test';

for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) {
  test(`core surfaces remain readable across widths: ${locale} ${theme}`, async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }]);
    await page.addInitScript(({ locale, theme }) => { localStorage.setItem('locale', locale); localStorage.setItem('theme', theme); }, { locale, theme });
    await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({ json: { ok: true } }));
    for (const [name, route] of [['home', '/'], ['capture', '/capture'], ['studio', '/studio'], ['echo', '/echo/overview'], ['settings', '/settings']] as const) {
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('#main-content')).toBeVisible();
      if (name === 'home') await expect(page.getByRole('heading', { name: locale === 'zh' ? '继续你的工作' : 'Continue your work' })).toBeVisible();
      if (name === 'capture') await expect(page.locator('textarea').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      for (const width of [390, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(250); // wait for the documented <=200ms layout/theme transition
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `/tmp/ui-craft-${name}-${locale}-${theme}-${width}.png`, caret: 'initial' });
      }
    }
    expect(errors).toEqual([]);
  });
}
