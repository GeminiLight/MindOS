import { test, expect } from '@playwright/test';
import { validateBranchStory } from '../../packages/mindos/src/knowledge/branch-replay';

test.use({ actionTimeout: 15000, launchOptions: process.env.MINDOS_E2E_CHROME ? { executablePath: process.env.MINDOS_E2E_CHROME } : {} });
const ref = { messageId: 'm', quote: 'proposal.docx 已保存；探索项需要单独验证。' };
// Synthetic artifacts exercise the same provenance contract without copying private files.
const story = validateBranchStory({ id: 'participation-e2e', runtime: 'codex', title: '提案练习', messages: [{ id: 'm', role: 'assistant', text: ref.quote }] }, {
  title: '你会怎样写进提案？', summary: '合成剧情，用于验证判断与反馈。',
  artifacts: [{ id: 'row', title: '任务范围', fileName: 'proposal.docx', sha256: 'a'.repeat(64), capturedAt: '2026-10-22T01:00:00Z', modifiedAt: '2026-10-21T01:00:00Z', source: ref, columns: ['任务', '状态'], rows: [['Motion', '探索候选']] }],
  scenes: [{ id: 'first', title: '范围还没有验证，怎样继续？', context: '文档需要明确下一步，验证尚未完成。', evidence: [ref], historicalChoiceId: 'recorded', prediction: { question: '读者会怎样理解这一行？', options: ['确定承诺', '探索候选'] }, choices: [
    { id: 'unknown', label: '先写成承诺', description: '先确定范围。', proposal: ref, outcome: { kind: 'unobserved', title: '这条路没有后续记录', steps: [] } },
    { id: 'recorded', label: '单列探索项', description: '为验证留出空间。', proposal: ref, nextSceneId: 'second', outcome: { kind: 'recorded', title: '记录里的后续', steps: [{ title: '提案中出现了状态列', text: '查看表格，再对照自己的预测。', refs: [ref], artifactIds: ['row'] }] } },
  ] }, { id: 'second', title: '下一轮先看什么？', context: '探索项需要新的验证证据。', evidence: [ref], choices: [
    { id: 'check', label: '查看验证结果', description: '判断条件是否改变。', proposal: ref, outcome: { kind: 'recorded', title: '记录里的后续', steps: [{ title: '记录到这里结束', text: '保留验证条件。', refs: [ref] }] } },
    { id: 'wait', label: '等待更多证据', description: '暂缓判断。', proposal: ref, outcome: { kind: 'unobserved', title: '没有后续', steps: [] } },
  ] }],
});

test('unknown exits preserve a validation plan and historical continuation keeps predictions and artifacts distinct', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', 'light'); });
  await page.route('**/api/echo/replays?*', route => route.fulfill({ json: { stories: [story], sources: [], sourceErrors: [] } }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/echo/replay?story=${story.id}`);
  const canvas = page.locator('[data-replay-canvas]');
  await expect(page.locator('.replay-compact-identity')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await canvas.getByRole('button', { name: 'A · 先写成承诺', exact: true }).click();
  await canvas.getByRole('button', { name: '记下验证思路', exact: true }).click();
  await page.locator('#replay-nextCheck').fill('先请读者复述他们理解的承诺范围。');
  await canvas.getByRole('button', { name: /接回当时的记录/ }).click();
  const prediction = page.locator('.replay-prediction');
  await expect(prediction).toBeVisible();
  await prediction.getByRole('button', { name: '确定承诺', exact: true }).click();
  await page.locator('#replay-prediction-reason').fill('因为任务已经进入表格。');
  await page.getByRole('tab', { name: '路径对照', exact: true }).click();
  await page.getByRole('tab', { name: '剧情回放', exact: true }).click();
  await expect(page.locator('#replay-prediction-reason')).toHaveValue('因为任务已经进入表格。');
  await prediction.getByRole('button', { name: /记下预测/ }).click();
  await canvas.getByRole('button', { name: '真实文件摘录', exact: true }).click();
  const moment = page.locator('.replay-moment-panel');
  await expect(moment.getByRole('table')).toContainText('探索候选');
  await expect(moment).toContainText('确定承诺');
  await expect(moment.locator('.replay-history-boundary')).toBeVisible();
  await page.screenshot({ path: '/tmp/echo-canvas-pr-artifact-desktop.png' });
  await page.locator('#replay-revision').fill('状态列比有没有进入表格更能说明承诺范围。');
  await page.screenshot({ path: '/tmp/echo-canvas-pr-participation-desktop.png' });
  await page.reload();
  await canvas.getByRole('button', { name: '真实文件摘录', exact: true }).click();
  await expect(page.locator('#replay-revision')).toHaveValue('状态列比有没有进入表格更能说明承诺范围。');
  await page.setViewportSize({ width: 390, height: 844 });
  await moment.getByRole('cell', { name: 'Motion', exact: true }).scrollIntoViewIfNeeded();
  await expect(moment.getByRole('cell', { name: 'Motion', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/echo-canvas-pr-participation-mobile.png' });
  await canvas.getByRole('button', { name: '进入下一个分岔点', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'A · 查看验证结果', exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: '回看分岔点 1', exact: true }).click();
  await canvas.getByRole('button', { name: 'A · 先写成承诺', exact: true }).click();
  await canvas.getByRole('button', { name: '记下验证思路', exact: true }).click();
  await expect(page.locator('#replay-nextCheck')).toHaveValue('先请读者复述他们理解的承诺范围。');
});
