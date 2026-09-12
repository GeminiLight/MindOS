import { test, expect } from '@playwright/test';

// Native stores and Agent turns are fixtures: this never writes an external Agent's files.
for (const id of ['claude', 'codex', 'opencode']) {
  test(`${id}: browses all projects, retries pages and opens the original session`, async ({ page, context }) => {
    test.setTimeout(90_000);
    const runtime = { id, name: id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : 'OpenCode', kind: id === 'opencode' ? 'acp' : id, status: 'available', capabilities: {}, lifecycle: {}, compatibility: {} };
    await context.addInitScript(runtime => {
      localStorage.setItem('theme', 'light'); localStorage.setItem('locale', 'en');
      localStorage.setItem('mindos:last-agent-runtime', JSON.stringify(runtime));
    }, runtime);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/setup', route => route.fulfill({ json: { setupPending: false, walkthroughCompleted: true, guideState: { active: false, dismissed: true } } }));
    await page.route('**/api/agent-runtimes?*', route => route.fulfill({ json: { runtimes: [runtime], installed: [], notInstalled: [] } }));
    let saved: { runtimeSessionBinding?: { externalSessionId: string; cwd: string }; messages?: Array<{ content: string }> } | undefined;
    await page.route('**/api/agent/sessions', route => {
      if (route.request().method() === 'POST') { saved = route.request().postDataJSON().session; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: [] });
    });
    const entry = (n: number) => ({ id: `${id}-${n}`, title: `${runtime.name} design ${n}`, name: `${runtime.name} design ${n}`, preview: `Design system iteration ${n}`, cwd: '/workspace/original-project', updatedAt: Date.now() - n * 1000 });
    let failPage = true;
    const listRequests: URL[] = [];
    const listPattern = id === 'codex' ? '**/api/agent-runtimes/codex/threads?*' : '**/api/agent-runtimes/external-sessions?*';
    await page.route(listPattern, route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('sessionId')) return route.fulfill({ json: { sessions: [{ ...entry(31), turns: [{ role: 'user', content: 'Original design question' }, { role: 'assistant', content: 'Original design answer' }] }] } });
      listRequests.push(url);
      if (url.searchParams.has('cursor') && failPage) return route.fulfill({ status: 503, json: { error: 'Session service unavailable. Retry loading this page.' } });
      const query = url.searchParams.get(id === 'codex' ? 'searchTerm' : 'query');
      const second = url.searchParams.has('cursor');
      const rows = query || second ? [entry(31)] : Array.from({ length: 30 }, (_, i) => entry(i));
      return route.fulfill({ json: { [id === 'codex' ? 'data' : 'sessions']: rows, nextCursor: query || second ? null : '30' } });
    });
    if (id === 'codex') await page.route('**/api/agent-runtimes/codex/threads/codex-31?*', route => route.fulfill({ json: { thread: { ...entry(31), turns: [{ role: 'user', content: 'Original design question' }, { role: 'assistant', content: 'Original design answer' }] } } }));
    await page.goto('/chat/new', { waitUntil: 'domcontentloaded' });
    await page.getByTitle('Session history', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'All projects', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-runtime-session-row]')).toHaveCount(30);
    expect(listRequests[0].searchParams.has('cwd')).toBe(false);
    await page.screenshot({ animations: 'disabled', path: `/tmp/external-sessions-${id}-desktop.png` });
    await page.getByRole('button', { name: 'Load more sessions', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Session service unavailable' })).toBeVisible();
    await expect(page.locator('[data-runtime-session-row]')).toHaveCount(30);
    failPage = false;
    await page.getByRole('button', { name: 'Load more sessions', exact: true }).click();
    await expect(page.locator('[data-runtime-session-row]')).toHaveCount(31);
    await page.getByPlaceholder('Search conversations...').fill('design 31');
    await expect(page.locator('[data-runtime-session-row]')).toHaveCount(1);
    expect(listRequests.at(-1)?.searchParams.has('cursor')).toBe(false);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ animations: 'disabled', path: `/tmp/external-sessions-${id}-dark.png` });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator('[data-runtime-session-row]').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(280);
    await page.screenshot({ animations: 'disabled', path: `/tmp/external-sessions-${id}-mobile.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('[data-runtime-session-row]').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => saved?.runtimeSessionBinding?.externalSessionId).toBe(`${id}-31`);
    expect(saved?.runtimeSessionBinding?.cwd).toBe('/workspace/original-project');
    expect(saved?.messages?.map(message => message.content)).toEqual(['Original design question', 'Original design answer']);
    expect(errors).toEqual([]);
  });
}
