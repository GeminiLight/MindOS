import { test, expect } from '@playwright/test';

test('third-party controls preserve native labels, extra settings, and command argument hints', async ({ page, context }) => {
  test.setTimeout(90_000);
  const runtime = { id: 'gemini', name: 'Gemini', kind: 'acp', status: 'available', capabilities: {}, lifecycle: {}, compatibility: {} };
  await context.addInitScript(runtime => {
    localStorage.setItem('theme', 'light'); localStorage.setItem('locale', 'en');
    localStorage.setItem('mindos:last-agent-runtime', JSON.stringify(runtime));
  }, runtime);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/setup', route => route.fulfill({ json: { setupPending: false, walkthroughCompleted: true, guideState: { active: false, dismissed: true } } }));
  await page.route('**/api/agent-runtimes?*', route => route.fulfill({ json: { runtimes: [runtime] } }));
  await page.route('**/api/agent/sessions', route => route.fulfill({ json: route.request().method() === 'POST' ? { ok: true } : [] }));
  const control = (configId: string, options: Array<{ id: string; label: string }>) => ({ status: 'available', owner: 'external', source: 'session-observed', configId, currentValue: options[0].id, options, summary: 'Agent choices' });
  const model = control('model', Array.from({ length: 45 }, (_, i) => ({ id: `model-${i}`, label: `Model ${i}` })));
  const mode = control('mode', [{ id: 'ask', label: 'Ask before editing' }, { id: 'code', label: 'Code' }]);
  await page.route('**/api/agent-runtimes/session-projections?*', route => route.fulfill({ json: { projections: [{
    schemaVersion: 1, runtimeId: 'gemini', runtimeName: 'Gemini', runtimeKind: 'acp', source: 'acp-session-snapshot', status: 'active',
    controls: { model, mode, thoughtLevel: { status: 'unavailable', source: 'unavailable', options: [] } },
    configOptions: [{ type: 'select', configId: 'model', category: 'model', currentValue: 'model-0', options: model.options }, { type: 'select', configId: 'mode', category: 'mode', currentValue: 'ask', options: mode.options }, { type: 'select', configId: 'context_size', category: 'model_config', label: 'Context window', description: 'How much project context to include.', currentValue: 'small', options: [{ id: 'small', label: 'Standard' }, { id: 'large', label: 'Extended', description: 'Includes more context for longer tasks.' }] }],
    slashCommands: { status: 'available', source: 'session-observed', commands: [{ id: 'review', name: 'review', description: 'Review a branch or commit', inputHint: 'branch or commit' }] },
    toolEvents: { status: 'unavailable', calls: [], summary: {} }, permissionEvents: { status: 'unavailable', events: [], pending: [] }, reasons: [],
  }] } }));
  await page.goto('/chat/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Gemini Agent Mode', exact: true })).toContainText('Ask before editing');
  const settings = page.getByRole('button', { name: 'Agent options', exact: true });
  await expect(settings).toHaveCount(1);
  await settings.click();
  const dialog = page.getByRole('dialog', { name: 'Agent options' });
  await expect(dialog).toBeInViewport();
  await page.getByLabel('Context window', { exact: true }).selectOption('large');
  await expect(dialog).toContainText('Includes more context');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mindos-acp-runtime-options.v1:gemini') || '{}').configValues?.context_size)).toBe('large');
  await page.screenshot({ path: '/tmp/agent-native-options-desktop.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Gemini Model', exact: true }).click();
  const models = page.getByRole('listbox', { name: 'Gemini Model' });
  const bounds = await models.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Model 44', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mindos-acp-runtime-options.v1:gemini') || '{}').configValues?.model)).toBe('model-44');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await settings.click();
  await expect(dialog).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/agent-native-options-mobile-dark.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  const composer = page.locator('textarea').first();
  await composer.fill('/rev');
  await expect(page.getByRole('button').filter({ hasText: '/review' })).toContainText('branch or commit');
  expect(errors).toEqual([]);
});
