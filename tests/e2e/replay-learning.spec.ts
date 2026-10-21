import { test, expect as baseExpect } from '@playwright/test';
import type { BranchStory } from '../../packages/mindos/src/knowledge/branch-replay';
const expect=baseExpect.configure({timeout:30000});
test.use({viewport:{width:1536,height:1100},actionTimeout:15000,launchOptions:process.env.MINDOS_E2E_CHROME?{executablePath:process.env.MINDOS_E2E_CHROME}:{}});
test.setTimeout(120000);
const reference={messageId:'m',quote:'整场 0.99；局部 0.69；原方案后来调整。'};
const story:BranchStory={id:'replay-test-learning',fingerprint:'learning-v1',title:'先看到证据，再改变判断',summary:'合成数据，仅用于交互验证。',source:{id:'test-learning',runtime:'codex',title:'观察',messages:[{id:'m',role:'assistant',text:reference.quote}]},scenes:[{
 id:'first',title:'你要先核对什么？',context:'有一个很高的总分，你需要决定如何检查。',evidence:[reference],
 reconsideration:{prompt:'哪个局部变化能检验总分？',insight:'总分无法替代逐个检查。',refs:[{messageId:'m',quote:'局部 0.69'}]},choices:[
  {id:'a',label:'先汇总筛查',description:'先看总分',proposal:reference,tradeoff:{benefit:'快速筛查',cost:'可能遗漏局部',check:'怎样用一个变异验证这条路线？',refs:[reference]},outcome:{kind:'unobserved',title:'尚无验证结果',steps:[]}},
  {id:'b',label:'增加逐个检查',description:'看局部',proposal:reference,tradeoff:{benefit:'定位局部差异',cost:'要逐个运行',check:'新增列覆盖了什么？',refs:[reference]},rejoin:{note:'原方案收到反馈后，改为逐个检查再继续。',refs:[reference]},outcome:{kind:'recorded',title:'记录',steps:[
   {title:'先看到高分',text:'先看总分。',refs:[{messageId:'m',quote:'整场 0.99'}],signals:[{label:'整场',value:'0.99'}]},
   {title:'再看到局部差异',text:'核对局部。',refs:[reference],signals:[{label:'局部',value:'0.69'}]},
  ]}},
 ],
}]};
test.beforeEach(async({page,context,baseURL})=>{
 await context.addCookies([{name:'locale',value:'zh',url:baseURL!}]);await page.addInitScript(()=>{localStorage.setItem('locale','zh');localStorage.setItem('theme','light');});
 await page.route('**/api/echo/replays?*',route=>route.fulfill({json:{stories:[story],sources:[],sourceErrors:[]}}));
});

test('unknown routes lead to a test question, revisiting uses observed clues, and interpretation waits for evidence',async({page})=>{
 await page.setViewportSize({width:1536,height:1100});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(`/echo/replay?story=${story.id}`,{waitUntil:'domcontentloaded'});const canvas=page.locator('[data-replay-canvas]');
 await expect(canvas).toHaveAttribute('data-camera-ready','true');await expect(canvas).toContainText('快速筛查');await expect(canvas).toContainText('要逐个运行');
 // The map may scale, but the text needed for choosing must remain readable.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const displayedType=await canvas.locator('.replay-map-choice .replay-tradeoff').first().evaluate(element=>parseFloat(getComputedStyle(element).fontSize)*element.getBoundingClientRect().width/(element as HTMLElement).offsetWidth);
 expect(displayedType).toBeGreaterThanOrEqual(12);
 const cards=await canvas.locator('.replay-map-choice').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return{top:r.top,bottom:r.bottom};}));
 expect(cards[1].top).toBeGreaterThan(cards[0].bottom);
 await expect(canvas).not.toContainText('总分无法替代逐个检查。');
 await canvas.getByRole('button',{name:'A · 先汇总筛查',exact:true}).click();
 await expect(canvas.locator('.replay-moment-panel')).toContainText('怎样用一个变异验证');await expect(canvas.getByRole('button',{name:'继续回放',exact:true})).toHaveCount(0);
 await canvas.getByRole('button',{name:'试另一条路',exact:true}).click();await canvas.getByRole('button',{name:'B · 增加逐个检查',exact:true}).click();
 await expect(canvas.locator('.replay-signals dd')).toHaveText('0.99');await expect(canvas.getByRole('complementary',{name:'原会话在这里调整了方向',exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'路径对照',exact:true}).click();const review=canvas.getByRole('region',{name:'比较已看到的结果'});
 await expect(review).not.toContainText('哪个局部变化能检验总分');await expect(review).not.toContainText('总分无法替代逐个检查。');
 await review.getByRole('button',{name:'继续这条路',exact:true}).click();await canvas.getByRole('button',{name:'回到分岔点',exact:true}).click();
 await expect(canvas.getByRole('complementary',{name:'带着新线索再选',exact:true})).toContainText('先看到高分');
 await canvas.getByRole('button',{name:'B · 增加逐个检查',exact:true}).click();await canvas.getByRole('button',{name:'继续回放',exact:true}).click();
 await expect(canvas.getByRole('complementary',{name:'原会话在这里调整了方向',exact:true})).toContainText('收到反馈后');
 await page.getByRole('tab',{name:'路径对照',exact:true}).click();await expect(review).toContainText('总分无法替代逐个检查。');await expect(review).toContainText('不能据此比较执行结果');
});

test('benefits, costs and a return question stay readable on a narrow screen',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(`/echo/replay?story=${story.id}`,{waitUntil:'domcontentloaded'});const canvas=page.locator('[data-replay-canvas]');
 const sheet=canvas.getByRole('region',{name:'这次，换你来决定'});await expect(sheet).toBeVisible();await expect(sheet).toContainText('可能遗漏局部');
 await sheet.getByRole('button',{name:'跳到选项 B',exact:true}).click();await sheet.getByRole('button',{name:'B · 增加逐个检查',exact:true}).click();
 await canvas.getByRole('button',{name:'回到分岔点',exact:true}).click();await expect(sheet.getByRole('complementary',{name:'带着新线索再选',exact:true})).toContainText('先看到高分');await expect(sheet).not.toContainText('哪个局部变化');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('a saved local experience opens and restores progress even while its catalog is pending',async({page})=>{
 const id=process.env.MINDOS_TEST_SAVED_REPLAY;test.skip(!id,'Requires an existing local saved story; never creates private fixtures.');
 const pending:import('@playwright/test').Route[]=[];
 await page.unroute('**/api/echo/replays?*');
 await page.route('**/api/echo/replays?*',route=>{pending.push(route);});
 try{
  await page.goto(`/echo/replay?story=${encodeURIComponent(id!)}`,{waitUntil:'domcontentloaded'});
  const canvas=page.locator('[data-replay-canvas]');await expect(canvas).toHaveAttribute('data-camera-ready','true',{timeout:90000});
  await canvas.locator('.replay-choice-hit').first().click();await expect(canvas.locator('[data-status=current].replay-map-step,[data-status=current].replay-map-unknown')).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});await expect(canvas).toHaveAttribute('data-camera-ready','true',{timeout:60000});
  await expect(page.locator('.replay-resume-notice')).toContainText('已接上上次');
  expect(pending.length).toBeGreaterThan(0);
 }finally{for(const route of pending)await route.abort().catch(()=>{});}
});
