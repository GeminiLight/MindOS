import { test, expect } from '@playwright/test';

// Real workspace UI with deterministic API responses; no user records or Agent calls.
for (const locale of ['en', 'zh'] as const) {
  test(`return, practice, reflect and recover: ${locale}`, async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    const zh = locale === 'zh';
    await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }]);
    await page.addInitScript(locale => { localStorage.setItem('locale', locale); localStorage.setItem('theme', 'light'); }, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    const loops = Array.from({ length: 30 }, (_, i) => ({
      id: 'learn-' + i.toString(16).padStart(24, '0'), schemaVersion: 1, version: 1, stage: 'reflecting', archived: false,
      createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
      source: { cardId: 'fixture-' + i, title: zh ? `学习记录 ${i + 1}：核实依据再做判断` : `Practice ${i + 1}: Check the evidence before judging`, content: 'Test fixture, not a personal note.', sessions: [] },
      reflection: undefined as { before: string; understanding: string } | undefined,
      attempts: [] as { rule: string; plan: { situation: string; action: string; check: string; reviewOn: string }; review?: { outcome: string; observation: string; revisedRule: string } }[],
    }));
    let failNextSave = false;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ json: { setupPending: false, sessions: [], skills: [], agents: [], plugins: [], surfaces: [], cards: [], files: [], items: [], configured: false } }));
    await page.route('**/api/echo/transfer**', route => route.fulfill({ json: { practices: [], unavailableCount: 0 } }));
    await page.route('**/api/echo/inquiries', route => route.fulfill({ json: { inquiries: [], unavailableCount: 0 } }));
    await page.route('**/api/echo/learning', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { loops } });
      if (failNextSave) { failNextSave = false; return route.fulfill({ status: 503, json: { code: 'storage' } }); }
      const body = route.request().postDataJSON();
      const loop = loops.find(item => item.id === body.id)!;
      if (body.version !== loop.version) return route.fulfill({ status: 409, json: { code: 'conflict' } });
      if (body.action === 'reflect') { loop.stage = 'planning'; loop.reflection = { before: body.before, understanding: body.understanding }; }
      if (body.action === 'plan') { loop.stage = 'practicing'; loop.attempts = [{ rule: loop.reflection!.understanding, plan: { situation: body.situation, action: body.experiment, check: body.check, reviewOn: body.reviewOn } }]; }
      if (body.action === 'review') { loop.stage = 'reviewed'; loop.attempts.at(-1)!.review = { outcome: body.outcome, observation: body.observation, revisedRule: body.revisedRule }; }
      if (body.action === 'archive' || body.action === 'restore') loop.archived = body.action === 'archive';
      loop.version++;
      return route.fulfill({ json: { loop } });
    });
    await page.goto('/echo/learning');
    await page.getByRole('button', { name: loops[0].source.title, exact: true }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('learning') === loops[0].id);
    await expect(page.locator('textarea[name=before]')).toBeInViewport();
    await expect(page.locator('#learning-record-list')).toBeHidden();
    await page.locator('textarea[name=before]').fill('I used to trust summaries.');
    await page.locator('textarea[name=understanding]').fill('Check the study design.');
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(page.locator('textarea[name=understanding]')).toHaveValue('Check the study design.');
    await expect(page.getByText(zh ? '已恢复本机草稿。尚未提交，请核对后继续。' : 'Draft restored from this device. Review it before submitting.')).toBeVisible();
    failNextSave = true;
    await page.getByRole('button', { name: zh ? '保存我的理解' : 'Save my understanding', exact: true }).click();
    await expect(page.locator('#echo-learning').getByRole('alert')).toBeFocused();
    await expect(page.locator('textarea[name=understanding]')).toHaveValue('Check the study design.');
    await page.getByRole('button', { name: zh ? '保存我的理解' : 'Save my understanding', exact: true }).click();
    await expect(page.locator('legend').filter({ hasText: zh ? '一次实践' : 'One practice' }).first()).toBeFocused();
    await page.locator('textarea[name=situation]').fill('The next paper I read');
    await page.locator('textarea[name=experiment]').fill('Inspect the design');
    await page.locator('textarea[name=check]').fill('Explain the evidence limits');
    await page.locator('input[name=reviewOn]').fill('2099-01-01');
    await page.getByRole('button', { name: zh ? '保存这次实践' : 'Save this practice', exact: true }).click();
    await expect(page.locator('time[datetime="2099-01-01"]')).toBeVisible();
    await page.getByRole('radio', { name: zh ? '部分有帮助' : 'Partly helped', exact: true }).check();
    await page.locator('textarea[name=observation]').fill('I found a claim with weak support');
    await page.locator('textarea[name=revisedRule]').fill('Describe the evidence before judging');
    await page.getByRole('button', { name: zh ? '保存复盘' : 'Save reflection', exact: true }).click();
    await expect(page.getByText(zh ? '本次复盘已保存' : 'Reflection saved for this attempt', { exact: true })).toBeFocused();
    await page.screenshot({ path: `/tmp/human-learning-journey-complete-${locale}.png`, fullPage: true });
    await page.getByRole('button', { name: zh ? '归档' : 'Archive', exact: true }).click();
    await expect(page.getByRole('button', { name: zh ? '恢复' : 'Restore', exact: true })).toBeVisible();
    await page.getByRole('button', { name: zh ? '选择其他记录' : 'Choose another record', exact: true }).click();
    await expect(page.getByRole('button', { name: zh ? '已归档' : 'Archived', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: zh ? '恢复' : 'Restore', exact: true }).click();
    await page.getByRole('button', { name: loops[1].source.title, exact: true }).click();
    await expect(page.locator('textarea[name=before]')).toBeInViewport();
    await page.reload();
    await expect(page.getByRole('heading', { level: 3, name: loops[1].source.title, exact: true })).toBeVisible();
    await expect(page.locator('textarea[name=before]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/human-learning-journey-after-${locale}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
