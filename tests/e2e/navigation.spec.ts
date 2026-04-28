import { test, expect, Page } from 'playwright/test';

test.describe('Navigation', () => {
  test('homepage loads and shows sidebar', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="sidebar"]').or(page.locator('nav'))).toBeVisible();
  });

  test('search modal opens with Cmd+K', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[role="dialog"]').or(page.locator('input[placeholder]'))).toBeVisible();
  });
});
