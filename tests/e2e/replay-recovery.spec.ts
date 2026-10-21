import { test, expect as baseExpect } from '@playwright/test';
const expect=baseExpect.configure({timeout:20000});
import type { BranchStory } from '../../packages/mindos/src/knowledge/branch-replay';
test.use({viewport:{width:1536,height:1100},actionTimeout:15000,launchOptions:process.env.MINDOS_E2E_CHROME?{executablePath:process.env.MINDOS_E2E_CHROME}:{}});
test.setTimeout(120000);
const source={id:'test-session',runtime:'codex' as const,title:'连续的本地判断',project:'演练项目',messages:[{id:'m',role:'user' as const,text:'前面的背景。'.repeat(180)+'这里是对应的证据。后面继续观察。'}]};
const reference={messageId:'m',quote:'这里是对应的证据'};
const story:BranchStory={id:'replay-test-recovery',fingerprint:'recovery-v1',title:'连续判断的回访',summary:'从真实记录的结构中练习，测试数据不会写入本地会话。',source,scenes:['first','second','third'].map((id,index)=>({id,title:`判断 ${index+1}：你想怎样继续？`,context:'已经观察到变化。先决定如何验证，再逐步看看接下来发生什么。',evidence:[reference],choices:['a','b'].map((choiceId,i)=>({id:choiceId,label:i?'继续验证':'先观察',description:i?'跟进后面的判断。':'观察这次变化。',proposal:reference,nextSceneId:index<2&&i===1?['second','third'][index]:undefined,outcome:{kind:'recorded' as const,title:'记录里的后续',steps:[1,2,3].map(n=>({title:`观察到变化 ${n}`,text:`第 ${n} 步的已记录变化。`,refs:[reference]}))}}))}))};
const summary={...source,messages:undefined};
test.beforeEach(async({page,context,baseURL})=>{
 await context.addCookies([{name:'locale',value:'zh',url:baseURL!}]);
 await page.addInitScript(()=>{localStorage.setItem('locale','zh');localStorage.setItem('theme','light');});
 await page.route('**/api/echo/replays?*',route=>route.fulfill({json:{stories:[story],sources:[summary],sourceErrors:[]}}));
});

test('can revisit earlier forks and resume an unfinished route without spoilers',async({page})=>{
 await page.goto(`/echo/replay?story=${story.id}`,{waitUntil:'domcontentloaded'});const canvas=page.locator('[data-replay-canvas]');
  await expect(canvas).toHaveAttribute('data-camera-ready','true',{timeout:60000});
 const trail=canvas.getByRole('navigation',{name:'分岔点导航'});
 await expect(trail.getByRole('button',{name:'尚未到达的分岔点 3',exact:true})).toBeDisabled();
 await canvas.getByRole('button',{name:'B · 继续验证',exact:true}).click();
 await canvas.getByRole('button',{name:'继续回放',exact:true}).click();
 await page.getByRole('tab',{name:'路径对照',exact:true}).click();
 await canvas.getByRole('button',{name:'继续这条路',exact:true}).click();
 await expect(canvas.locator('.replay-map-step[data-status=current]')).toContainText('第 2 步');
 await expect(canvas).not.toContainText('第 3 步');
 await canvas.getByRole('button',{name:'继续回放',exact:true}).click();
 await canvas.getByRole('button',{name:'进入下一个分岔点',exact:true}).click();
 await expect(trail.getByRole('button',{name:'回看分岔点 2',exact:true})).toHaveAttribute('aria-current','step');
 await trail.getByRole('button',{name:'回看分岔点 1',exact:true}).click();
 await expect(canvas.locator('.replay-map-step')).toHaveCount(3);
 await trail.getByRole('button',{name:'回看分岔点 2',exact:true}).click();
 await expect(trail.getByRole('button',{name:'回看分岔点 2',exact:true})).toHaveAttribute('aria-current','step');
  await page.reload({waitUntil:'domcontentloaded'});await expect(canvas).toHaveAttribute('data-camera-ready','true',{timeout:60000});await expect(page.locator('.replay-resume-notice')).toContainText('已接上上次');
});

test('a route ending leads to an observed decision chain with a saved personal takeaway',async({page})=>{
 await page.goto(`/echo/replay?story=${story.id}`,{waitUntil:'domcontentloaded'});const canvas=page.locator('[data-replay-canvas]');
  await expect(canvas).toHaveAttribute('data-camera-ready','true',{timeout:60000});
 await canvas.getByRole('button',{name:'A · 先观察',exact:true}).click();
 await canvas.getByRole('button',{name:'继续回放',exact:true}).click();
 await page.getByRole('tab',{name:'我的判断链',exact:true}).click();
 const chain=page.getByRole('region',{name:'我的判断链',exact:true});
 await expect(chain).toContainText('第 2 步');await expect(chain).not.toContainText('第 3 步');await expect(chain).not.toContainText('判断 2');
 await chain.getByLabel('下次遇到类似情况，你会先核对什么？').fill('先核对哪个证据能区分两种解释。');
 await page.getByRole('tab',{name:'剧情回放',exact:true}).click();
 await canvas.getByRole('button',{name:'继续回放',exact:true}).click();
 await canvas.getByRole('button',{name:'回看判断链',exact:true}).click();
 await page.reload({waitUntil:'domcontentloaded'});
  await expect(canvas).toHaveAttribute('data-camera-ready','true',{timeout:60000});
 await page.getByRole('tab',{name:'我的判断链',exact:true}).click();
 await expect(chain.getByRole('textbox')).toHaveValue('先核对哪个证据能区分两种解释。');
 await chain.getByRole('button',{name:'回到这里再选',exact:true}).click();
 await expect(canvas).toBeVisible();await expect(canvas.locator('.replay-map-step')).toHaveCount(3);
});

test('source failures recover within one dialog and preserve the canvas',async({page})=>{
 await page.route('**/api/echo/replays',route=>route.fulfill({status:422,json:{error:'这段会话暂无可验证的分支',source}}));
 await page.goto(`/echo/replay?story=${story.id}`,{waitUntil:'domcontentloaded'});
 await page.locator('.replay-page').getByRole('button',{name:'换一段经历',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'整理成剧情',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('暂无可验证的分支');
 await expect(dialog).toHaveCount(1);
 await dialog.getByRole('button',{name:'查看这段原文',exact:true}).click();
 await expect(dialog.locator('.replay-original')).toBeVisible();
 await dialog.getByRole('button',{name:'返回会话选择',exact:true}).click();
 await expect(dialog.getByRole('alert')).toBeVisible();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.locator('[data-replay-canvas]')).toBeVisible();
});

test('a quote near the end of a long source is highlighted and scrolled into view',async({page})=>{
 await page.goto(`/echo/replay?story=${story.id}`,{waitUntil:'domcontentloaded'});const canvas=page.locator('[data-replay-canvas]');
 await canvas.getByRole('button',{name:'A · 先观察',exact:true}).click();
 await canvas.locator('.replay-map-step[data-status=current]').getByRole('button',{name:'展开这一步',exact:true}).click();
 const inspector=canvas.getByRole('complementary',{name:'原文与线索'});
 await inspector.getByRole('button',{name:'查看这段原文',exact:true}).click();
 await expect(inspector.locator('mark')).toHaveText(reference.quote);
 await expect(inspector.locator('mark')).toBeInViewport();
 await expect(inspector.getByRole('button',{name:'返回线索',exact:true})).toBeInViewport();
});

test('five routes stay readable at 320px and allow a choice without canvas hunting',async({page})=>{
 const wide={...story,id:'replay-test-five',scenes:[{...story.scenes[0],choices:['a','b','c','d','e'].map((id,index)=>({...story.scenes[0].choices[0],id,label:`路线 ${index+1}：观察与验证`,description:'中文与 emoji 🧭 的较长选项仍能读完，再做选择。'}))}]};
 await page.route('**/api/echo/replays?*',route=>route.fulfill({json:{stories:[wide],sources:[],sourceErrors:[]}}));
 await page.setViewportSize({width:320,height:700});await page.goto(`/echo/replay?story=${wide.id}`,{waitUntil:'domcontentloaded'});
 const canvas=page.locator('[data-replay-canvas]');const decisions=canvas.getByRole('region',{name:'这次，换你来决定'});
  await expect(canvas).toHaveAttribute('data-camera-ready','true',{timeout:60000});
 await expect(decisions).toBeVisible();
 await decisions.getByRole('button',{name:'跳到选项 E',exact:true}).click();
 const choice=decisions.getByRole('button',{name:'E · 路线 5：观察与验证',exact:true});await expect(choice).toBeInViewport();
 expect(await choice.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
 await choice.click();await expect(canvas.locator('.replay-moment-panel')).toContainText('第 1 步');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('storage failure stays visible on a narrow screen while exploration still works',async({page})=>{
 await page.addInitScript(()=>{
  const setItem=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(key.startsWith('mindos:branch-replay:'))throw new Error('Storage blocked');return setItem.call(this,key,value);};
 });
 await page.setViewportSize({width:390,height:844});await page.goto(`/echo/replay?story=${story.id}`,{waitUntil:'domcontentloaded'});
 await expect(page.locator('.replay-private')).toContainText('浏览器未允许保存进度');
 await expect(page.locator('.replay-private')).toBeVisible();
 await expect(page.locator('[data-replay-canvas]').getByRole('region',{name:'这次，换你来决定'})).toBeVisible();
 await expect(page.locator('[data-replay-canvas]').getByRole('button',{name:'A · 先观察',exact:true})).toHaveCount(1);
 await page.locator('[data-replay-canvas]').getByRole('button',{name:'A · 先观察',exact:true}).click();
 await expect(page.locator('.replay-moment-panel')).toContainText('第 1 步');
});
