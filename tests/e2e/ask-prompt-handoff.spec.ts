import { expect, test } from '@playwright/test';

test('home prompt ideas preserve an unfinished Ask draft until explicitly replaced', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore prompt ideas' }).click();
  const input = page.locator('[data-chat-content-variant="home"] textarea.ask-composer-input:visible').first();
  await input.fill('My unfinished plan');
  await page.getByRole('tabpanel').getByRole('button').first().click();

  await expect(input).toHaveValue('My unfinished plan');
  await expect(page.getByText('You have an unfinished draft')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep my draft' })).toBeFocused();
  await page.screenshot({ path: '/tmp/mindos-ask-prompt-handoff-home.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Use new prompt' }).click();
  await expect(input).not.toHaveValue('My unfinished plan');
});

test('an empty or whitespace-only composer accepts a prompt without a conflict notice', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore prompt ideas' }).click();
  const input = page.locator('[data-chat-content-variant="home"] textarea.ask-composer-input:visible').first();
  await input.fill('   ');
  await page.getByRole('tabpanel').getByRole('button').first().click();
  await expect(input).toHaveValue(/Help me organize my recent unstructured notes/);
  await expect(page.getByText('You have an unfinished draft')).toHaveCount(0);
});

test('Ask empty-state suggestions keep an unfinished draft and dismiss the offer when editing continues', async ({ page }) => {
  await page.route('**/api/agent/sessions', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: [] });
  });
  await page.goto('/capture');
  await page.getByRole('button', { name: /Ask MindOS/ }).click();
  const panel = page.getByRole('complementary', { name: 'MindOS panel' });
  await expect(panel.getByText('How can I help?')).toBeVisible();
  const input = panel.locator('textarea.ask-composer-input');
  await input.fill('My unfinished thought');
  await panel.getByText('Organize inbox').click();

  await expect(input).toHaveValue('My unfinished thought');
  await expect(panel.getByText('You have an unfinished draft')).toBeVisible();
  await page.screenshot({ path: '/tmp/mindos-ask-prompt-handoff-panel.png', animations: 'disabled' });
  await input.fill('My unfinished thought, continued');
  await expect(panel.getByText('You have an unfinished draft')).toHaveCount(0);
  await panel.getByText('Research a topic').click();
  await expect(panel.getByText('You have an unfinished draft')).toBeVisible();
  await panel.getByRole('button', { name: 'New session' }).click();
  await expect(panel.getByText('You have an unfinished draft')).toHaveCount(0);
  await expect(input).toHaveValue('');
});

test('runtime command insertion also protects a draft and ignores malformed commands', async ({ page }) => {
  await page.goto('/capture');
  await page.getByRole('button', { name: /Ask MindOS/ }).click();
  const panel = page.getByRole('complementary', { name: 'MindOS panel' });
  const input = panel.locator('textarea.ask-composer-input');
  await input.fill('Keep this draft');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mindos:runtime-command-insert', { detail: { text: '/invalid ' } }));
  });
  await expect(input).toHaveValue('Keep this draft');
  await expect(panel.getByText('You have an unfinished draft')).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mindos:runtime-command-insert', {
      detail: {
        text: '/review ', commandName: 'review',
        runtime: { id: 'mindos', kind: 'mindos', name: 'MindOS' },
      },
    }));
  });
  await expect(input).toHaveValue('Keep this draft');
  await expect(panel.getByText('You have an unfinished draft')).toBeVisible();
  await panel.getByRole('button', { name: 'Use new prompt' }).click();
  await expect(input).toHaveValue('/review ');
});

test('Chinese dark mobile offers a reachable draft choice without horizontal overflow', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', 'dark'); });
  await page.goto('/');
  await page.getByRole('button', { name: '展开任务灵感' }).click();
  const input = page.locator('[data-chat-content-variant="home"] textarea.ask-composer-input:visible').first();
  await input.fill('我写了一半的计划');
  await page.getByRole('tabpanel').getByRole('button').first().click();

  await expect(input).toHaveValue('我写了一半的计划');
  const keep = page.getByRole('button', { name: '保留当前草稿' });
  await expect(keep).toBeFocused();
  expect((await keep.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const notice = page.locator('[data-incoming-prompt-notice]');
  const card = page.locator('.ask-composer-card');
  const noticeBox = (await notice.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  expect(noticeBox.x - cardBox.x).toBeGreaterThanOrEqual(8);
  expect(await notice.evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const dismissActivity = page.getByRole('button', { name: '关闭提醒' });
  if (await dismissActivity.isVisible()) {
    await dismissActivity.click();
    await expect(page.locator('[data-changes-banner]')).toHaveCount(0);
  }
  await page.screenshot({ path: '/tmp/mindos-ask-prompt-handoff-mobile-zh.png', animations: 'disabled' });
});
