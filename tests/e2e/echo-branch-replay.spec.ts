import { test, expect as baseExpect } from '@playwright/test';
const expect=baseExpect.configure({timeout:20000});
test.use({viewport:{width:1536,height:1100},actionTimeout:15000,launchOptions:process.env.MINDOS_E2E_CHROME?{executablePath:process.env.MINDOS_E2E_CHROME}:{}});
test.setTimeout(90000);
test.beforeEach(async({page,context,baseURL})=>{
 await context.addCookies([{name:'locale',value:'zh',url:baseURL!}]);
 // Practice journeys must not depend on the owner's private session catalog.
 // Real source reconstruction is verified separately by API tests and local use.
 await page.route('**/api/echo/replays?*',route=>route.fulfill({json:{stories:[],sources:[],sourceErrors:[]}}));
});

test('replay preserves a failed route, explores another, and restores progress', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('locale','zh');localStorage.setItem('theme','light'); });
  await page.goto('/echo/replay',{waitUntil:'domcontentloaded'});
  const app=page.locator('.replay-page');
  await app.getByRole('button',{name:'演练示例',exact:true}).click();
  const canvas=app.locator('[data-replay-canvas]');
  const current=canvas.locator('.replay-map-step[data-status=current]');
  await expect(canvas).toBeVisible();
  const viewport=canvas.locator('.react-flow__viewport');
  const initial=await viewport.getAttribute('style');
  await canvas.getByRole('button',{name:'放大',exact:true}).click();
  await expect(viewport).not.toHaveAttribute('style',initial!);
  await canvas.getByRole('button',{name:'回到当前',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-camera-ready','true');
  await page.waitForTimeout(300);
  const forkView=await viewport.getAttribute('style');
  await app.getByRole('button',{name:'A · 清理已有缓存',exact:true}).click();
  await expect(viewport).not.toHaveAttribute('style',forkView!);
  await expect(current.getByText('实际显示：项目 B',{exact:true})).toBeVisible();
  await app.getByRole('button',{name:'继续回放',exact:true}).click();
  await expect(current.getByText('实际显示：项目 A',{exact:true})).toBeVisible();
  await current.getByRole('button',{name:'亲手改变条件',exact:true}).click();
  const oldTiming=canvas.getByRole('slider',{name:/旧请求返回时间/});
  await oldTiming.fill('100');
  await expect(canvas.locator('.replay-map-step[data-status=current]').getByRole('heading',{name:'当前内容正常显示',exact:true})).toBeVisible();
  await oldTiming.fill('900');
  await canvas.getByRole('button',{name:'收起线索',exact:true}).click();
  await app.getByRole('button',{name:'试另一条路',exact:true}).click();
  await expect(app.getByText('已试过',{exact:true})).toBeVisible();
  await expect(canvas.locator('.replay-map-step')).toHaveCount(2);
  await app.getByRole('button',{name:'B · 校验当前请求归属',exact:true}).click();
  await app.getByRole('button',{name:'继续回放',exact:true}).click();
  await expect(current.getByText('实际显示：项目 B',{exact:true})).toBeVisible();
  await expect(current.getByText('旧结果已到达，被忽略；当前内容保留。',{exact:true})).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(current.getByText('旧结果已到达，被忽略；当前内容保留。',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>{
    const outer=await canvas.boundingBox();const current=await canvas.locator('.replay-map-step[data-status=current]').boundingBox();
    return !!outer&&!!current&&current.x>=outer.x+4&&current.x+current.width<=outer.x+outer.width-4;
  }).toBe(true);
  await page.setViewportSize({width:1536,height:1100});
  await app.getByRole('tab',{name:'路径对照',exact:true}).click();
  const review=canvas.getByRole('region',{name:'比较已看到的结果',exact:true});
  await expect(review).toBeVisible();
  await expect(review.locator('article')).toHaveCount(2);
  expect(await review.locator('article h3').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await review.getByRole('button',{name:'定位这条路',exact:true}).first().click();
  await canvas.getByRole('button',{name:'回到当前',exact:true}).click();
  await expect.poll(async()=>Number((await viewport.getAttribute('style'))?.match(/scale\(([^)]+)\)/)?.[1]||0)).toBeGreaterThanOrEqual(.9);
  await canvas.getByRole('button',{name:'展开结果对照',exact:true}).click();
  await expect(canvas.locator('.replay-map-step')).toHaveCount(4);
  await expect(app.getByText('清理已有缓存',{exact:true}).first()).toBeVisible();
  await expect(app.getByText('校验当前请求归属',{exact:true}).first()).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await review.getByRole('button',{name:'B · 校验当前请求归属',exact:true}).click();
  await expect(review.locator('article').nth(1).getByRole('heading',{name:'校验当前请求归属',exact:true})).toBeInViewport();
});

test('reading original text keeps immersion and edited practice survives refresh',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('locale','zh');localStorage.setItem('theme','light');});
 await page.goto('/echo/replay?story=replay-example-request-race',{waitUntil:'domcontentloaded'});
 const canvas=page.locator('[data-replay-canvas]');const current=canvas.locator('.replay-map-step[data-status=current]');
 await canvas.getByRole('button',{name:'A · 清理已有缓存',exact:true}).click();
 await canvas.getByRole('button',{name:'继续回放',exact:true}).click();
 await canvas.getByRole('button',{name:'沉浸模式',exact:true}).click();
 await current.getByRole('button',{name:'亲手改变条件',exact:true}).click();
 const inspector=canvas.getByRole('complementary',{name:'原文与线索'});
 await inspector.getByRole('slider',{name:/旧请求返回时间/}).fill('100');
 await expect(current.getByRole('heading',{name:'当前内容正常显示',exact:true})).toBeVisible();
 const viewport=canvas.locator('.react-flow__viewport');await page.waitForTimeout(300);const before=await viewport.getAttribute('style');
 await inspector.getByRole('button',{name:'查看这段原文',exact:true}).first().click();
 await expect(canvas).toHaveAttribute('data-immersive','true');
 await expect(inspector.locator('.replay-original')).toBeVisible();
 await expect(viewport).toHaveAttribute('style',before!);
 await inspector.getByRole('button',{name:'返回线索',exact:true}).click();
 await inspector.getByRole('button',{name:'收起线索',exact:true}).click();
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(current.getByRole('heading',{name:'当前内容正常显示',exact:true})).toBeVisible();
 await expect(current.getByText('实际显示：项目 B',{exact:true})).toBeVisible();
});

test('canvas can pan, open evidence, and return from immersive mode',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('locale','zh');localStorage.setItem('theme','light');});
 await page.goto('/echo/replay?story=replay-example-request-race',{waitUntil:'domcontentloaded'});
 const canvas=page.locator('[data-replay-canvas]');
 await expect(canvas).toBeVisible();
 const viewport=canvas.locator('.react-flow__viewport');
 const pane=canvas.locator('.react-flow__pane');
 const bounds=await pane.boundingBox();
 await expect.poll(()=>viewport.getAttribute('style')).toContain('scale(');
 const before=await viewport.getAttribute('style');
 await page.mouse.move(bounds!.x+bounds!.width-80,bounds!.y+bounds!.height/2);
 await page.mouse.down();await page.mouse.move(bounds!.x+50,bounds!.y+bounds!.height/2+60,{steps:8});await page.mouse.up();
 await expect(viewport).not.toHaveAttribute('style',before!);
 await page.keyboard.press('Tab');
 const firstChoice=canvas.getByRole('button',{name:'A · 清理已有缓存',exact:true});
 await firstChoice.focus();
 await expect.poll(async()=>{
   const node=await firstChoice.boundingBox();const box=await canvas.boundingBox();
   return !!node&&!!box&&node.x>=box.x+4&&node.x+node.width<=box.x+box.width-4;
 }).toBe(true);
 await canvas.getByRole('button',{name:'查看线索',exact:true}).click();
 await expect(canvas.getByRole('complementary',{name:'原文与线索'})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(canvas.getByRole('complementary',{name:'原文与线索'})).toHaveCount(0);
 await canvas.getByRole('button',{name:'沉浸模式',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-immersive','true');
 await canvas.getByRole('button',{name:'退出沉浸',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-immersive','false');
});

test('practice remains usable when the local source catalog cannot be read',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('locale','zh'));
 await page.route('**/api/echo/replays?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Source unavailable'})}));
 await page.goto('/echo/replay?story=replay-example-request-race',{waitUntil:'domcontentloaded'});
 const canvas=page.locator('[data-replay-canvas]');
 await expect(canvas).toBeVisible();
 await canvas.getByRole('button',{name:'A · 清理已有缓存',exact:true}).click();
 await expect(canvas.getByText('实际显示：项目 B',{exact:true})).toBeVisible();
});
