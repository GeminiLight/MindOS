import { expect, test } from '@playwright/test';

test('Home keeps the Ask composer still while an unconfigured model check resolves', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/settings', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await new Promise(resolve => setTimeout(resolve, 650));
    return route.continue();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.ask-composer-card').first();
  const input = page.locator('textarea.ask-composer-input').first();
  await expect(input).toBeVisible();
  const initialTop = (await input.boundingBox())!.y;

  await expect(card.getByText('Connect a model provider before sending.')).toBeVisible();
  const settledTop = (await input.boundingBox())!.y;
  expect(Math.abs(settledTop - initialTop)).toBeLessThanOrEqual(2);
  await expect(page.locator('form:has(textarea.ask-composer-input) button[type="submit"]').first()).toBeDisabled();
  await page.screenshot({ path: '/tmp/mindos-home-ai-readiness-desktop.png', animations: 'disabled' });
});

test('mobile Ask composer keeps its controls easy to tap without oversized pills', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.locator('.ask-composer-card').first();
  await expect(card).toBeVisible();
  const controls = [
    card.getByRole('button', { name: 'Attach local file' }),
    card.locator('form button[type="submit"]'),
    card.getByRole('button', { name: 'Mode', exact: true }),
    card.getByRole('button', { name: 'Permission', exact: true }),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-home-ai-readiness-mobile.png', animations: 'disabled' });
});

test('a failed settings refresh keeps the known model warning and draft available', async ({ page }) => {
  await page.route('**/api/settings', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await new Promise(resolve => setTimeout(resolve, 450));
    return route.abort('failed');
  });
  await page.goto('/');
  const card = page.locator('.ask-composer-card').first();
  const warning = card.getByText('Connect a model provider before sending.');
  await expect(warning).toBeVisible();
  const input = card.locator('textarea.ask-composer-input');
  await input.fill('Keep this thought while checking settings');
  await page.waitForTimeout(650);
  await expect(warning).toBeVisible();
  await expect(input).toHaveValue('Keep this thought while checking settings');
  await expect(card.locator('form button[type="submit"]')).toBeDisabled();
});

test('connecting a model updates the initial readiness without losing the draft', async ({ page }) => {
  let configured = false;
  await page.route('**/api/settings', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ json: {
      ai: {
        activeProvider: 'p_openai',
        providers: [{ id: 'p_openai', name: 'OpenAI', protocol: 'openai', apiKey: configured ? 'test-key' : '', model: 'test-model', baseUrl: '' }],
      },
      envOverrides: {},
    } });
  });
  await page.goto('/');
  const card = page.locator('.ask-composer-card').first();
  const input = card.locator('textarea.ask-composer-input');
  await input.fill('A draft kept through setup');
  await expect(card.getByText('Connect a model provider before sending.')).toBeVisible();
  configured = true;
  await page.evaluate(() => window.dispatchEvent(new Event('mindos:settings-changed')));
  await expect(card.getByText('Connect a model provider before sending.')).toBeHidden();
  await expect(input).toHaveValue('A draft kept through setup');
  await expect(card.locator('form button[type="submit"]')).toBeEnabled();
  configured = false;
  await page.evaluate(() => window.dispatchEvent(new Event('mindos:settings-changed')));
  await expect(card.getByText('Connect a model provider before sending.')).toBeVisible();
  await expect(input).toHaveValue('A draft kept through setup');
  await expect(card.locator('form button[type="submit"]')).toBeDisabled();
});

test('an older settings response cannot undo a newer model connection', async ({ page }) => {
  let phase: 'initial' | 'stale' | 'configured' = 'initial';
  let releaseStale!: () => void;
  const staleGate = new Promise<void>(resolve => { releaseStale = resolve; });
  let held = 0;
  let settled = 0;
  await page.route('**/api/settings', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const requestPhase = phase;
    if (requestPhase === 'stale') { held += 1; await staleGate; }
    await route.fulfill({ json: {
      ai: {
        activeProvider: 'p_openai',
        providers: [{ id: 'p_openai', name: 'OpenAI', protocol: 'openai', apiKey: requestPhase === 'configured' ? 'test-key' : '', model: 'test-model', baseUrl: '' }],
      },
      envOverrides: {},
    } });
    if (requestPhase === 'stale') settled += 1;
  });
  await page.goto('/');
  const card = page.locator('main.app-main-scrollport .ask-composer-card').first();
  const warning = card.getByText('Connect a model provider before sending.');
  const input = card.locator('textarea.ask-composer-input');
  await expect(warning).toBeVisible();
  await input.fill('Keep this idea after connecting');
  phase = 'stale';
  await page.evaluate(() => window.dispatchEvent(new Event('mindos:settings-changed')));
  await expect.poll(() => held).toBeGreaterThan(0);
  phase = 'configured';
  await page.evaluate(() => window.dispatchEvent(new Event('mindos:settings-changed')));
  await expect(warning).toBeHidden();
  const model = card.getByRole('button', { name: /OpenAI.*test-model/ });
  await expect(model).toBeVisible();
  releaseStale();
  await expect.poll(() => settled).toBe(held);
  await page.waitForTimeout(100);
  await expect(warning).toBeHidden();
  await expect(model).toBeVisible();
  await expect(card.locator('form button[type="submit"]')).toBeEnabled();
  await expect(input).toHaveValue('Keep this idea after connecting');
});

test('a failed settings refresh preserves a configured model and its draft', async ({ page }) => {
  let failRefresh = false;
  let failedRequests = 0;
  await page.route('**/api/settings', route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (failRefresh) {
      failedRequests += 1;
      return route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
    }
    return route.fulfill({ json: {
      ai: { activeProvider: 'p_openai', providers: [{ id: 'p_openai', name: 'OpenAI', protocol: 'openai', apiKey: 'test-key', model: 'test-model', baseUrl: '' }] },
      envOverrides: {},
    } });
  });
  await page.goto('/');
  const card = page.locator('main.app-main-scrollport .ask-composer-card').first();
  const input = card.locator('textarea.ask-composer-input');
  await input.fill('Keep this configured draft');
  const model = card.getByRole('button', { name: /OpenAI.*test-model/ });
  await expect(model).toBeVisible();
  await expect(card.locator('form button[type="submit"]')).toBeEnabled();
  failRefresh = true;
  await page.evaluate(() => window.dispatchEvent(new Event('mindos:settings-changed')));
  await expect.poll(() => failedRequests).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  await expect(model).toBeVisible();
  await expect(card.locator('form button[type="submit"]')).toBeEnabled();
  await expect(input).toHaveValue('Keep this configured draft');
});

test('mobile Home waits for the user to focus the composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const input = page.locator('textarea.ask-composer-input').first();
  await expect(input).toBeVisible();
  await page.waitForTimeout(300);
  expect(await input.evaluate(element => document.activeElement === element)).toBe(false);
  await input.click();
  expect(await input.evaluate(element => document.activeElement === element)).toBe(true);
});

test('desktop Home still focuses the composer for keyboard-first entry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const input = page.locator('textarea.ask-composer-input').first();
  await expect(input).toBeVisible();
  await expect.poll(() => input.evaluate(element => document.activeElement === element)).toBe(true);
});

test('a long mobile draft remains reachable when the keyboard reduces viewport height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const homeComposer = page.locator('main.app-main-scrollport [data-walkthrough="ask-button"]');
  const input = homeComposer.locator('textarea.ask-composer-input');
  await input.fill('Research note with substantial detail. '.repeat(90));
  await page.setViewportSize({ width: 390, height: 350 });
  const send = homeComposer.locator('form button[type="submit"]');
  const bounds = await send.evaluate(element => ({
    sendBottom: element.getBoundingClientRect().bottom,
    containerBottom: element.closest('[data-walkthrough="ask-button"]')!.getBoundingClientRect().bottom,
  }));
  expect(bounds.sendBottom).toBeLessThanOrEqual(bounds.containerBottom + 1);
  await send.scrollIntoViewIfNeeded();
  const sendBox = await send.boundingBox();
  expect(sendBox).not.toBeNull();
  expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(350);
  await expect(input).toHaveValue('Research note with substantial detail. '.repeat(90));
  await page.screenshot({ path: '/tmp/mindos-home-mobile-long-draft.png', animations: 'disabled' });
});

test('Chinese dark Home keeps a long draft and send control accessible in a short viewport', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('theme', 'dark'); localStorage.setItem('locale', 'zh'); });
  await page.goto('/');
  const homeComposer = page.locator('main.app-main-scrollport [data-walkthrough="ask-button"]');
  const input = homeComposer.locator('textarea.ask-composer-input');
  const draft = '共同进化需要在人与智能体之间建立可验证的学习循环。'.repeat(80);
  await input.fill(draft);
  await page.setViewportSize({ width: 390, height: 350 });
  const send = homeComposer.locator('form button[type="submit"]');
  await send.scrollIntoViewIfNeeded();
  const sendBox = await send.boundingBox();
  expect(sendBox).not.toBeNull();
  expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(350);
  await expect(input).toHaveValue(draft);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-home-mobile-long-draft-zh-dark.png', animations: 'disabled' });
});
