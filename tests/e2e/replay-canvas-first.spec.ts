import { test, expect as baseExpect } from '@playwright/test';
import type { BranchStory } from '../../packages/mindos/src/knowledge/branch-replay';

const expect=baseExpect.configure({timeout:20000});
test.use({ actionTimeout:15000, launchOptions: process.env.MINDOS_E2E_CHROME ? { executablePath: process.env.MINDOS_E2E_CHROME } : {} });
test.setTimeout(90000);
const ref = { messageId: 'm', quote: '候选任务仍需验证。任务表已标出验证条件。' };
const story: BranchStory = {
 id: 'replay-canvas-contract', fingerprint: 'canvas-contract-v1', title: '这项新能力，要不要承诺交付？', summary: '这是供自动化测试使用的合成剧情。',
 source: { id: 'canvas-contract', runtime: 'codex', title: '提案取舍', messages: [{ id: 'm', role: 'assistant', text: ref.quote }] },
 artifacts: [{ id: 'file', title: '任务表中的承诺边界', fileName: 'proposal.md', columns: ['任务', '状态'], rows: [['新能力', '探索候选']], capturedAt: '2026-10-22T00:00:00Z', modifiedAt: '2026-10-21T00:00:00Z', sha256: 'a'.repeat(64), source: ref }],
 scenes: [{ id: 'fork', title: '要把新能力写进首期目标吗？', context: '提案只有两页。你需要让读者区分首期承诺和仍待验证的方向。', evidence: [ref], historicalChoiceId: 'b',
 prediction: { question: '你预计读者会怎样理解任务表？', options: ['能区分承诺与候选', '仍会误读为承诺'] },
 reconsideration: { prompt: '如果只扫一眼任务表，边界足够清楚吗？', insight: '候选状态需要出现在读者真正看到的任务行里。', refs: [ref] },
 choices: [
  { id: 'a', label: '直接列为首期目标', description: '先推动方向落地', proposal: ref, tradeoff: { benefit: '便于争取资源', cost: '验证依赖还未确定', check: '哪项依赖会改变交付承诺？', refs: [ref] }, outcome: { kind: 'unobserved', title: '这条路尚未验证', steps: [] } },
  { id: 'b', label: '列为探索候选', description: '保留方向，说明边界', proposal: ref, tradeoff: { benefit: '区分方向与承诺', cost: '需要继续跟进验证', check: '读者能否看出候选状态？', refs: [ref] }, outcome: { kind: 'recorded', title: '已记录的后续', steps: [
   { title: '任务表增加候选状态', text: 'Agent 将新能力单列为探索候选。', refs: [ref] },
   { title: '验证条件写入任务行', text: '任务表已标出验证条件。', artifactIds: ['file'], refs: [ref] },
  ] } },
 ] }],
};

test.beforeEach(async ({ page, context, baseURL }) => {
 await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
 await page.addInitScript(() => { localStorage.setItem('locale', 'zh'); localStorage.setItem('theme', 'light'); });
 await page.route('**/api/echo/replays?*', route => route.fulfill({ json: { stories: [story], sources: [], sourceErrors: [] } }));
 await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('laptop choices stay readable on the map and predictions, artifacts and rewind keep spatial history', async ({ page }) => {
 await page.setViewportSize({ width: 1280, height: 720 });
 await page.goto(`/echo/replay?story=${story.id}`, { waitUntil: 'domcontentloaded' });
 const canvas = page.locator('[data-replay-canvas]');
 await expect(canvas).toHaveAttribute('data-camera-ready', 'true');
 await expect(canvas.locator('.replay-decision-sheet,.replay-moment-panel')).toHaveCount(0);
 const choices = canvas.locator('.replay-map-choice');
 await expect(choices).toHaveCount(2);
 await expect.poll(async () => {
  const outer = (await canvas.boundingBox())!;
  const bounds = await choices.evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  return bounds.every(r => r.top >= outer.y + 65 && r.bottom <= outer.y + outer.height - 80) && bounds[0].bottom < bounds[1].top;
 }).toBe(true);
 const size = await choices.first().locator('.replay-tradeoff').evaluate(el => parseFloat(getComputedStyle(el).fontSize) * el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth);
 expect(size).toBeGreaterThanOrEqual(12);
 await page.screenshot({ path: '/tmp/echo-canvas-first-laptop.png' });
 await canvas.getByRole('button', { name: 'B · 列为探索候选', exact: true }).click();
 const prediction = page.getByRole('region', { name: '揭晓之前，留一个预测' });
 await expect(prediction).toBeVisible();
 await expect(canvas).toBeVisible();
 await expect(canvas.locator('.replay-map-step')).toHaveCount(0);
 await prediction.getByRole('button', { name: '能区分承诺与候选', exact: true }).click();
 await prediction.getByRole('button', { name: '记下预测，查看记录', exact: true }).click();
 await expect(canvas.locator('.replay-map-step[data-status=current]')).toContainText('任务表增加候选状态');
 await expect(canvas.locator('.replay-moment-panel')).toHaveCount(0);
 await canvas.getByRole('button', { name: '继续回放', exact: true }).click();
 await canvas.getByRole('button', { name: '真实文件摘录', exact: true }).click();
 await expect(canvas.locator('.replay-artifact')).toContainText('探索候选');
 await expect(canvas.locator('.replay-flow-layer')).not.toHaveAttribute('inert');
 await page.screenshot({ path: '/tmp/echo-canvas-artifact-laptop.png' });
 await canvas.getByRole('button', { name: '只看路线图', exact: true }).click();
 await canvas.getByRole('button', { name: '试另一条路', exact: true }).click();
 await expect(canvas.locator('.replay-map-step')).toHaveCount(2);
 await expect(canvas.getByRole('complementary', { name: '带着新线索再选' })).toContainText('验证条件写入任务行');
 await canvas.getByRole('button', { name: 'A · 直接列为首期目标', exact: true }).click();
 await expect(canvas.locator('.replay-map-unknown')).toBeVisible();
 const unknownBounds = (await canvas.locator('.replay-map-unknown').boundingBox())!;
 const otherResult = (await canvas.locator('.replay-map-step').first().boundingBox())!;
 expect(unknownBounds.y + unknownBounds.height).toBeLessThan(otherResult.y);
 await expect(canvas.locator('.replay-moment-panel')).toHaveCount(0);
 await expect(canvas.getByRole('button', { name: '接回当时的记录', exact: true })).toBeVisible();
 await page.screenshot({ path: '/tmp/echo-canvas-unknown-laptop.png' });
});

test('phone users can navigate choices on the map without zooming out the text', async ({ page }) => {
 await page.setViewportSize({ width: 390, height: 844 });
 await page.goto(`/echo/replay?story=${story.id}`, { waitUntil: 'domcontentloaded' });
 const canvas = page.locator('[data-replay-canvas]');
 await expect(canvas).toHaveAttribute('data-camera-ready', 'true');
 await expect(canvas.locator('.replay-decision-sheet')).toHaveCount(0);
 await canvas.getByRole('button', { name: '跳到选项 B', exact: true }).click();
 await canvas.getByRole('button', { name: 'B · 列为探索候选', exact: true }).click();
 await page.getByRole('button', { name: '直接看记录', exact: true }).click();
 const current = canvas.locator('.replay-map-step[data-status=current]');
 await expect(current).toBeInViewport();
 await expect.poll(async () => {
  const a = (await canvas.boundingBox())!; const b = (await current.boundingBox())!;
  return b.x >= a.x && b.x + b.width <= a.x + a.width;
 }).toBe(true);
 expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
 await page.screenshot({ path: '/tmp/echo-canvas-mobile.png' });
});

test('immersive mode includes the prediction and lets readers return to their route', async ({ page }) => {
 await page.setViewportSize({ width: 1280, height: 720 });
 await page.goto(`/echo/replay?story=${story.id}`, { waitUntil: 'domcontentloaded' });
 const canvas = page.locator('[data-replay-canvas]');
 await expect(canvas).toHaveAttribute('data-camera-ready', 'true');
 await canvas.getByRole('button', { name: '沉浸模式', exact: true }).click();
 await expect(canvas).toHaveAttribute('data-immersive', 'true');
 await canvas.getByRole('button', { name: 'B · 列为探索候选', exact: true }).click();
 const prediction = page.locator('.replay-prediction');
 await expect(prediction).toBeVisible();
 expect(await prediction.evaluate(el => document.fullscreenElement?.contains(el))).toBe(true);
 await prediction.getByRole('button', { name: '能区分承诺与候选', exact: true }).click();
 await prediction.getByRole('button', { name: '记下预测，查看记录', exact: true }).click();
 await expect(canvas.locator('.replay-map-step[data-status=current]')).toContainText('任务表增加候选状态');
 await canvas.getByRole('button', { name: '退出沉浸', exact: true }).click();
 await expect(canvas).toHaveAttribute('data-immersive', 'false');
});

test('five long choices remain reachable without showing future chapters', async ({ page }) => {
 const expanded: BranchStory = { ...story, scenes: [{ ...story.scenes[0], historicalChoiceId: undefined, choices: Array.from({ length: 5 }, (_, index) => ({ ...story.scenes[0].choices[0], id: `choice-${index}`, label: `路线 ${index + 1}：先明确验证条件，再决定是否纳入当前承诺`, tradeoff: { ...story.scenes[0].choices[0].tradeoff!, benefit: '为不同读者保留足够的判断依据，同时避免把尚未完成验证的计划误写为已经确定的交付承诺。' } })) }, ...Array.from({ length: 7 }, (_, index) => ({ ...story.scenes[0], id: `later-${index}`, title: '不该提前出现的后续问题' }))] };
 await page.route('**/api/echo/replays?*', route => route.fulfill({ json: { stories: [expanded], sources: [], sourceErrors: [] } }));
 await page.setViewportSize({ width: 1280, height: 720 });
 await page.goto(`/echo/replay?story=${story.id}`, { waitUntil: 'domcontentloaded' });
 const canvas = page.locator('[data-replay-canvas]');
 await expect(canvas).toHaveAttribute('data-camera-ready', 'true');
 await expect(page.getByRole('heading', { name: '不该提前出现的后续问题' })).toHaveCount(0);
 await canvas.getByRole('button', { name: '跳到选项 E', exact: true }).click();
 await canvas.getByRole('button', { name: 'E · 路线 5：先明确验证条件，再决定是否纳入当前承诺', exact: true }).click();
 await expect(canvas.locator('.replay-map-unknown[data-status=current]')).toBeInViewport();
 await canvas.getByRole('button', { name: '记下验证思路', exact: true }).click();
 await page.getByLabel('你会先怎样验证这条路？（可选）').fill('先验证一个边界条件');
 await page.getByLabel('你会先怎样验证这条路？（可选）').press('Escape');
 await expect(canvas.locator('.replay-moment-panel')).toHaveCount(0);
 await page.setViewportSize({ width: 390, height: 844 });
 await canvas.getByRole('button', { name: '试另一条路', exact: true }).click();
 const routeJump = canvas.locator('.replay-route-jump'); const scenes = canvas.locator('.replay-scene-trail');
 const a = (await routeJump.boundingBox())!; const b = (await scenes.boundingBox())!;
 expect(a.x + a.width).toBeLessThanOrEqual(b.x);
 await canvas.getByRole('button', { name: '跳到选项 C', exact: true }).click();
 await canvas.getByRole('button', { name: 'C · 路线 3：先明确验证条件，再决定是否纳入当前承诺', exact: true }).click();
 await expect(canvas.locator('.replay-map-unknown[data-status=current]')).toBeInViewport();
 await page.screenshot({ path: '/tmp/echo-canvas-five-routes-mobile.png' });
});
