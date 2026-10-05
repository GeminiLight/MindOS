import { expect, test } from '@playwright/test';

test('a long restored conversation leaves the mobile Home composer in the first viewport', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => localStorage.setItem('locale', 'zh'));
  await page.route('**/api/agent/sessions', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: [{
      id: 'home-long-session', title: '正在继续的研究', source: 'quick', createdAt: 1_000, updatedAt: 2_000,
      messages: [
        { role: 'user', content: '帮我复盘这次研究。', timestamp: 1_000 },
        { role: 'assistant', content: '这是值得保留的观察、证据和下一步。'.repeat(120), timestamp: 2_000 },
      ],
    }] });
  });
  await page.route('**/api/setup', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: {
      guideState: {
        active: true, dismissed: false, step1Done: true, askedAI: false,
        agentPromptDone: false, nextStepIndex: 0, template: 'empty',
      },
      activeProvider: 'skip', providerConfigs: [],
    } });
  });
  await page.route('**/api/changes?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('op') === 'summary') {
      return route.fulfill({ json: { unreadCount: 1, totalCount: 1, lastSeenAt: null } });
    }
    if (url.searchParams.get('op') === 'list') {
      return route.fulfill({ json: { events: [{
        id: 'home-review', ts: '2026-09-27T00:00:00.000Z', op: 'update_lines',
        path: 'Research/notes.md', source: 'agent', summary: 'Updated note',
      }] } });
    }
    return route.continue();
  });

  await page.goto('/');
  await expect(page.getByText('快速上手')).toBeVisible();
  const reviewReminder = page.locator('[data-changes-banner-kind="agent-review"]');
  await expect(reviewReminder).toBeVisible();
  const chat = page.locator('main.app-main-scrollport [data-chat-content-variant="home"]').first();
  await expect(chat.getByText(/这是值得保留的观察/).first()).toBeVisible();
  const composer = chat.locator('.ask-composer-card').first();
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  expect(composerBox && composerBox.y + composerBox.height).toBeLessThanOrEqual(844 - 12);
  const log = chat.getByRole('log');
  expect(await log.evaluate(element => element.scrollHeight > element.clientHeight + 50)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-home-first-screen-mobile-zh.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 667 });
  await expect.poll(async () => {
    const box = await composer.boundingBox();
    return box ? box.y + box.height : Infinity;
  }).toBeLessThanOrEqual(655);
  await page.setViewportSize({ width: 320, height: 568 });
  const reminderBox = await reviewReminder.boundingBox();
  expect(reminderBox?.height).toBeLessThanOrEqual(54);
  await expect.poll(async () => {
    const box = await composer.boundingBox();
    return box ? box.y + box.height : Infinity;
  }).toBeLessThanOrEqual(556);
  const shortMetrics = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    return {
      chat: rect('main [data-chat-content-variant="home"]'),
      log: rect('main [data-chat-content-variant="home"] [role="log"]'),
      composer: rect('main [data-chat-content-variant="home"] .ask-composer-card'),
    };
  });
  expect(Math.round(shortMetrics.log?.height ?? 0), JSON.stringify(shortMetrics)).toBeGreaterThanOrEqual(80);
  expect(shortMetrics.log && shortMetrics.composer && shortMetrics.log.bottom <= shortMetrics.composer.top).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-home-first-screen-small-zh.png', animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  await chat.getByRole('button', { name: '专注模式' }).click();
  await expect(chat).toHaveAttribute('data-chat-focus-mode', 'true');
  await expect(reviewReminder).toBeHidden();
  const focusShell = page.locator('[data-home-focus-shell]');
  await expect(focusShell).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const focusComposer = await composer.boundingBox();
  expect(focusComposer && focusComposer.y + focusComposer.height).toBeLessThanOrEqual(832);
  await page.screenshot({ path: '/tmp/mindos-home-first-screen-mobile-focus-zh.png', animations: 'disabled' });
  await chat.getByRole('button', { name: '退出专注' }).click();
  await expect(reviewReminder).toBeVisible();
});

test('Home keeps resumed work compact on desktop with a clear path to focus mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/agent/sessions', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: [{
      id: 'home-desktop-session', title: 'Research notes', source: 'quick', createdAt: 1_000, updatedAt: 2_000,
      messages: [{ role: 'assistant', content: 'A concise research observation. '.repeat(180), timestamp: 2_000 }],
    }] });
  });

  await page.goto('/');
  const chat = page.locator('main.app-main-scrollport [data-chat-content-variant="home"]').first();
  await expect(chat.getByText(/A concise research observation/).first()).toBeVisible();
  const composer = chat.locator('.ask-composer-card').first();
  const composerBox = await composer.boundingBox();
  expect(composerBox && composerBox.y + composerBox.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: '/tmp/mindos-home-first-screen-desktop-compact.png', animations: 'disabled' });
  const input = chat.locator('textarea.ask-composer-input').first();
  await input.fill('Keep this draft when opening the conversation');
  await chat.getByRole('button', { name: 'Focus mode' }).click();
  await expect(input).toHaveValue('Keep this draft when opening the conversation');
  const focusShell = page.locator('[data-home-focus-shell]');
  const focusGeometry = await focusShell.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, radius: Number.parseFloat(style.borderTopLeftRadius) };
  });
  expect(focusGeometry.top).toBeGreaterThan(50);
  expect(focusGeometry.right).toBeLessThan(1440 - 8);
  expect(focusGeometry.bottom).toBeLessThan(900 - 8);
  expect(focusGeometry.radius).toBeGreaterThanOrEqual(11);
  expect((await composer.boundingBox())?.width).toBeLessThanOrEqual(840);
  await page.screenshot({ path: '/tmp/mindos-home-first-screen-desktop-focus.png', animations: 'disabled' });
});

test('closing an Agent review reminder stays closed across reload until a new edit arrives', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let eventId = 'first-edit';
  await page.route('**/api/changes?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('op') === 'summary') {
      return route.fulfill({ json: { unreadCount: 1, totalCount: 1, lastSeenAt: '2026-06-22T00:00:00.000Z' } });
    }
    if (url.searchParams.get('op') === 'list') {
      return route.fulfill({ json: { events: [{
        id: eventId, ts: '2026-06-22T00:01:00.000Z', op: 'update_lines', path: 'Research/notes.md',
        source: 'agent', summary: 'Updated lines 1-2',
      }] } });
    }
    return route.continue();
  });

  await page.goto('/capture');
  const banner = page.locator('[data-changes-banner-kind="agent-review"]');
  await expect(banner).toBeVisible();
  await expect.poll(() => banner.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
  const box = await banner.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(80);
  const dismissButton = banner.getByRole('button', { name: 'Dismiss notification' });
  const reviewLink = banner.getByRole('link', { name: 'Review changes' });
  for (const target of [dismissButton, reviewLink]) {
    const targetBox = await target.boundingBox();
    expect(targetBox?.width).toBeGreaterThanOrEqual(44);
    expect(targetBox?.height).toBeGreaterThanOrEqual(44);
  }
  const headingBox = await page.getByRole('heading', { name: 'New capture' }).boundingBox();
  expect(box && headingBox && box.y + box.height).toBeLessThanOrEqual((headingBox?.y ?? 0) - 4);
  await dismissButton.click({ timeout: 5000 });
  await expect(banner).toBeHidden();

  await page.reload();
  await expect(banner).toBeHidden();
  eventId = 'second-edit'; // Same count and timestamp; identity, not count, must reopen it.
  await page.evaluate(() => window.dispatchEvent(new Event('mindos:files-changed')));
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('link', { name: 'Review changes' })).toHaveAttribute('href', '/changelog?source=agent');
  await page.screenshot({ path: '/tmp/mindos-agent-review-reminder-mobile.png', animations: 'disabled' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New capture' })).toBeVisible();
  await expect(banner).toBeVisible();
  await expect.poll(() => banner.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
  await page.screenshot({ path: '/tmp/mindos-agent-review-reminder-mobile-dark.png', animations: 'disabled' });
});
