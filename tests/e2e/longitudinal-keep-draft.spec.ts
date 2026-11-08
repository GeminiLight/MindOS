import { test, expect } from '@playwright/test';

const studyId = `cohort-${'a'.repeat(24)}`;
const participantId = `participant-${'b'.repeat(24)}`;

for (const scenario of [
  { locale: 'en', width: 1280, method: 'Revised method', evidence: 'Evidence and reason for the change', keep: 'Keep the current method', warning: 'Discard this unsubmitted revision?', confirm: 'Discard draft and keep current method', unsent: 'Unsubmitted draft', synced: 'Study progress synced' },
  { locale: 'zh', width: 390, method: '修订后的方法', evidence: '修改依据与理由', keep: '保留当前方法', warning: '放弃尚未提交的方法修订？', confirm: '放弃草稿并保留当前方法', unsent: '草稿尚未提交', synced: '研究进度已同步' },
] as const) {
  test(`preserves a drafted method until deliberate confirmation (${scenario.locale})`, async ({ browser }) => {
    test.setTimeout(240_000); // A cold Next development route can compile during either visit.
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 844 }, locale: scenario.locale });
    const page = await context.newPage();
    let writes = 0;
    const base = {
      id: participantId, studyId, version: 3, title: 'Synthetic study', consent: 'Consent', withdrawal: 'You may withdraw',
      accessExpired: false, erased: false, round: 0, roundCount: 2, runs: [],
    };
    await page.route(`**/api/study/longitudinal/${studyId}`, async route => {
      if (route.request().method() === 'PATCH') {
        writes++;
        expect(JSON.parse(route.request().postData() ?? '{}')).toMatchObject({ action: 'keep', version: 3 });
        await route.fulfill({ json: { view: { ...base, version: 4, status: 'waiting', dueAt: '2026-10-01T00:00:00.000Z' } } });
      } else await route.fulfill({ json: { view: { ...base, status: 'revision', method: 'Check evidence first', updateAllowed: true } } });
    });
    await page.goto(`/study/longitudinal/${studyId}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(scenario.method, { exact: true }).fill('Compare evidence across cases');
    await page.getByLabel(scenario.evidence).fill('The earlier case exposed an exception');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('textarea[name="revised-method"]')).toHaveValue('Compare evidence across cases', { timeout: 90_000 });
    await expect(page.getByText(scenario.unsent, { exact: true })).toBeVisible();
    await expect(page.getByText(scenario.synced, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: scenario.keep, exact: true }).click();
    await expect(page.getByText(scenario.warning)).toBeVisible();
    await expect(page.locator('#keep-method-confirmation')).toBeFocused();
    await expect(page.locator('textarea[name="revised-method"]')).toHaveValue('Compare evidence across cases');
    await expect(page.getByRole('button', { name: scenario.confirm })).toBeInViewport();
    expect(writes).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/longitudinal-keep-draft-${scenario.locale}.png`, fullPage: true });
    await page.getByRole('button', { name: scenario.confirm }).click();
    await expect(page.getByRole('button', { name: scenario.confirm })).toHaveCount(0);
    expect(writes).toBe(1);
    await context.close();
  });
}
