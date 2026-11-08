import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Opt-in: start the app against this disposable vault, never a personal knowledge base.
const root = process.env.MINDOS_LEARNING_TEST_ROOT;
test('starts from a real insight, saves through the real API and exports the journal', async ({ page, context, baseURL }) => {
  test.skip(!root, 'Requires an isolated server and MINDOS_LEARNING_TEST_ROOT.');
  test.setTimeout(180_000);
  expect(path.resolve(root!)).toMatch(/^\/(?:private\/)?tmp\/mindos-learning-[^/]+$/);
  const cardId = 'journey-' + crypto.randomUUID();
  const now = new Date().toISOString();
  const card = { id: cardId, segment: 'insight', kind: 'judgment', title: 'Learning journey — isolated test insight ' + cardId.slice(-6), content: 'Check the original evidence before drawing a conclusion.',
    createdAt: now, updatedAt: now, generatedAt: now, generation: { method: 'lm', trigger: 'manual', locale: 'en' }, confidence: 0.8, status: 'active',
    source: { label: 'Test discussion', sessions: [{ id: 'test-session', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'What does this evidence actually support?' }] }] } };
  const file = path.join(root!, '.mindos/echo/cards.json');
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schemaVersion: 1, cards: [], segments: {} };
  state.cards.push(card); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state));
  // Verify the server actually reads our disposable vault before performing any mutations.
  const cards = await page.request.get('/api/echo/cards?segment=insight', { timeout: 120_000 });
  expect(cards.ok()).toBe(true);
  expect((await cards.json()).cards.some((item: { id: string }) => item.id === cardId)).toBe(true);
  await context.addCookies([{ name: 'locale', value: 'en', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('locale', 'en'); localStorage.setItem('theme', 'light'); });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/echo/learning' || (url.pathname === '/api/echo/cards' && route.request().method() === 'GET')) return route.continue();
    return route.fulfill({ json: { setupPending: false, sessions: [], skills: [], agents: [], plugins: [], cards: [], files: [], items: [], practices: [], inquiries: [], unavailableCount: 0 } });
  });
  await page.goto('/echo/learning');
  await page.getByRole('link', { name: /^(Choose an insight|Start from an insight)$/ }).click();
  await expect(page.getByText(card.title, { exact: true })).toBeVisible({ timeout: 60_000 });
  // The isolated vault contains only test insights. Use the newly seeded card's action.
  const title = page.getByText(card.title, { exact: true });
  const cardContainer = title.locator('xpath=ancestor::*[.//button[normalize-space()="Try it myself"]][1]');
  await cardContainer.getByRole('button', { name: 'Try it myself', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/echo/learning' && !!url.searchParams.get('learning'));
  await page.locator('textarea[name=before]').fill('I used to trust the summary.');
  await page.locator('textarea[name=understanding]').fill('Verify the original evidence.');
  await page.getByRole('button', { name: 'Save my understanding', exact: true }).click();
  await page.locator('textarea[name=situation]').fill('The next paper I read');
  await page.locator('textarea[name=experiment]').fill('Inspect the study design');
  await page.locator('textarea[name=check]').fill('Explain what the evidence supports');
  await page.locator('input[name=reviewOn]').fill('2099-01-01');
  await page.getByRole('button', { name: 'Save this practice', exact: true }).click();
  await page.getByRole('radio', { name: 'Partly helped', exact: true }).check();
  await page.locator('textarea[name=observation]').fill('One claim needed qualification.');
  await page.locator('textarea[name=revisedRule]').fill('State the limits before generalizing.');
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(page.getByText('Reflection saved for this attempt', { exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('learning')!;
  const saved = await (await page.request.get('/api/echo/learning?id=' + id)).json();
  expect(saved.loop.stage).toBe('reviewed');
  expect(saved.loop.attempts[0].review.revisedRule).toBe('State the limits before generalizing.');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export journal', exact: true }).click();
  const journal = await download;
  expect(fs.readFileSync((await journal.path())!, 'utf8')).toContain('State the limits before generalizing.');
  await page.screenshot({ path: '/tmp/human-learning-live-complete.png', fullPage: true });
});
