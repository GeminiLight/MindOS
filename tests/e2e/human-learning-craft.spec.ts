import { test, expect } from '@playwright/test';

const id = 'learn-' + 'a'.repeat(24);
for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark']) {
  test(`learning workspace: ${locale} ${theme}`, async ({ page, context, baseURL }) => {
    test.setTimeout(240_000);
    const zh = locale === 'zh';
    const title = zh ? '结论的强度，要与证据一致' : 'Match the strength of a claim to its evidence';
    const loop = {
      id, version: 1, stage: 'reflecting', archived: false, attempts: [],
      createdAt: '2026-09-22T08:00:00.000Z', updatedAt: '2026-09-22T08:00:00.000Z',
      source: { cardId: 'craft-fixture', title, content: zh ? '在下次阅读中，区分相关性与因果性。保留反例，也说明结论的适用范围。' : 'Distinguish correlation from causation. Keep counterexamples and state the limits of a claim.', sessions: [] },
    };
    let populated = false;
    let reviewMode = false;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }]);
    await page.addInitScript(({ locale, theme }) => { localStorage.setItem('locale', locale); localStorage.setItem('theme', theme); }, { locale, theme });
    // Isolate unrelated app chrome so screenshot checks do not compile or invoke Agent services.
    await page.route('**/api/**', route => route.fulfill({ json: {
      setupPending: false, sessions: [], skills: [], agents: [], plugins: [], surfaces: [],
      cards: [], files: [], items: [], configured: false,
    } }));
    await page.route('**/api/echo/learning', route => route.fulfill({
      status: route.request().method() === 'GET' ? 200 : 503,
      json: route.request().method() === 'GET' ? { loops: populated ? [reviewMode ? { ...loop, version: 3, stage: 'practicing', reflection: { before: 'Trust the summary', understanding: 'Check evidence' }, attempts: [{ rule: 'Check evidence', plan: { situation: 'Reading a paper', action: 'Check each claim', check: 'Locate evidence limits', reviewOn: '2026-09-22' } }] } : loop] : [] } : { code: 'storage' },
    }));
    await page.route('**/api/echo/transfer**', route => route.fulfill({ json: { practices: [], unavailableCount: 0 } }));
    await page.route('**/api/echo/inquiries', route => route.fulfill({ json: { inquiries: [], unavailableCount: 0 } }));
    await page.goto('/echo/learning');
    await expect(page.getByRole('heading', { level: 1, name: zh ? '学习' : 'Learning', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: zh ? '选择一条洞察' : 'Choose an insight', exact: true })).toBeVisible();
    await expect(page.getByText(zh ? '暂无待继续的练习。' : 'No pending practice.', { exact: false })).not.toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(250); // Allow the shared 200ms sidebar padding transition to finish.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `/tmp/human-learning-empty-${locale}-${theme}-${width}.png`, fullPage: true });
    }
    populated = true;
    // Old bookmarks must still land in the dedicated workspace with their selected record.
    await page.goto('/echo/growth?learning=' + id);
    await expect(page).toHaveURL(url => url.pathname === '/echo/learning' && url.searchParams.get('learning') === id, { timeout: 30_000 });
    await expect(page.getByLabel(zh ? '我原来是怎么想、怎么做的？' : 'What did I think or do before?')).toBeVisible();
    await page.getByLabel(zh ? '我原来是怎么想、怎么做的？' : 'What did I think or do before?').fill(zh ? '以前更关注摘要给出的结论。' : 'I used to trust the summary.');
    await page.getByLabel(zh ? '现在，我的理解有什么不同？' : 'What do I understand differently now?').fill(zh ? '先看研究设计，再判断证据能支持什么。' : 'Check the study design before judging what the evidence supports.');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(250); // Allow the shared 200ms sidebar padding transition to finish.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `/tmp/human-learning-record-${locale}-${theme}-${width}.png`, fullPage: true });
    }
    const search = page.getByRole('searchbox', { name: zh ? '查找学习记录' : 'Find learning records' });
    await search.fill('no-match-🪴');
    await expect(page.getByText(zh ? '没有找到匹配的记录' : 'No matching records')).toBeVisible();
    await expect(page.locator('textarea[name=before]')).not.toHaveValue('');
    await page.getByRole('button', { name: zh ? '清除搜索' : 'Clear search' }).click();
    await page.getByRole('button', { name: zh ? '保存我的理解' : 'Save my understanding', exact: true }).click();
    await expect(page.locator('#echo-learning').getByRole('alert')).toBeVisible();
    await expect(page.locator('textarea[name=understanding]')).not.toHaveValue('');
    await page.screenshot({ path: `/tmp/human-learning-error-${locale}-${theme}.png`, fullPage: true });
    const contrast = await page.locator('#echo-learning').evaluate(root => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const rgb = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const luminance = (color: number[]) => color.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
      return [...root.querySelectorAll('p, h2, h3, legend, button, textarea')].filter(el => el.getBoundingClientRect().height > 0).map(el => {
        const fg = rgb(getComputedStyle(el).color);
        let ancestor: Element | null = el; let bg = [255, 255, 255, 255];
        while (ancestor) { const color = rgb(getComputedStyle(ancestor).backgroundColor); if (color[3] === 255) { bg = color; break; } ancestor = ancestor.parentElement; }
        const a = luminance(fg), b = luminance(bg);
        return { text: el.textContent?.slice(0, 40), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    expect(contrast.filter(item => item.ratio < 4.5)).toEqual([]);
    // Keyboard focus is visible on the search input, including dark mode.
    await search.focus();
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, tag: el.tagName };
    });
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.style).not.toBe('none');
    reviewMode = true;
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('mindos-echo-draft-v1:')) localStorage.removeItem(key);
    });
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    const outcome = page.getByRole('radio', { name: zh ? '部分有帮助' : 'Partly helped', exact: true });
    await expect(outcome).toBeVisible();
    expect(await page.getByRole('radio', { checked: true }).count()).toBe(0);
    await outcome.check();
    await expect(outcome).toBeChecked();
    await page.screenshot({ path: `/tmp/human-learning-review-${locale}-${theme}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
