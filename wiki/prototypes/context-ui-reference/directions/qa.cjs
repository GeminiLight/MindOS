const {chromium} = require('../../../../node_modules/@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.MINDOS_DIRECTIONS_URL || 'http://127.0.0.1:4599/directions/';

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1600, height: 1080}, permissions: ['clipboard-write', 'clipboard-read']});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    assert.equal(await page.locator('button[data-direction]').count(), 3, 'Three real direction controls exist');
    await page.getByRole('heading', {name: '林若舟', exact: true}).waitFor();
    for (const direction of ['a','b','c']) {
      await page.locator(`button[data-direction="${direction}"]`).click();
      await page.waitForFunction(d => document.querySelector('#app-frame').dataset.direction === d, direction);
      assert(await page.getByRole('heading', {name: '林若舟', exact: true}).isVisible());
      const baseline = await context.newPage();
      await baseline.goto(base + '#' + direction + '/reading');
      await baseline.getByRole('heading', {name: '林若舟', exact: true}).waitFor();
      await baseline.screenshot({path: `/tmp/mindos-directions-${direction}.png`, fullPage: true});
      await baseline.screenshot({path: `/tmp/mindos-directions-${direction}-preview.png`});
      await baseline.close();
    }
    await page.locator('button[data-direction="a"]').click();
    await page.getByRole('button', {name: '查看原会话', exact: true}).click();
    await page.getByLabel('我的判断').fill('先把来源放在当前内容附近。');
    await page.locator('button[data-direction="b"]').click();
    assert.equal(await page.getByLabel('我的判断').inputValue(), '先把来源放在当前内容附近。');
    await page.getByRole('button', {name: '保留这条判断', exact: true}).click();
    await page.getByText('已保留这条判断', {exact: true}).waitFor();
    await page.getByLabel('我的判断').fill('这是尚未保留的修订。');
    await page.getByText('这次修订尚未保留；本次材料使用先前的已保留版本。', {exact: true}).waitFor();
    await page.getByRole('button', {name: '准备给 Agent', exact: true}).click();
    await page.getByLabel('带上已保留的判断').check();
    await page.getByRole('button', {name: '查看带走的内容', exact: true}).click();
    await page.getByLabel('材料预览').waitFor();
    assert.match(await page.getByLabel('材料预览').inputValue(), /先把来源放在当前内容附近/);
    assert.doesNotMatch(await page.getByLabel('材料预览').inputValue(), /这是尚未保留的修订/);
    await page.getByRole('button', {name: '复制材料', exact: true}).click();
    await page.getByText('已复制材料；外部接收尚未确认。', {exact: true}).waitFor();
    await page.getByRole('radio', {name: 'Cursor', exact: true}).check();
    assert(await page.getByRole('radio', {name: 'Cursor', exact: true}).evaluate(e => e === document.activeElement));
    assert.equal(await page.getByLabel('材料预览').count(), 0, 'Changing Agent clears the old preview');
    assert.equal(await page.getByText('已复制材料；外部接收尚未确认。', {exact: true}).count(), 0);
    await page.getByRole('button', {name: '关闭辅助内容', exact: true}).click();
    assert(await page.getByRole('button', {name: '准备给 Agent', exact: true}).evaluate(e => e === document.activeElement));
    await page.locator('details[data-folder="people"] summary').click();
    await page.waitForFunction(() => !document.querySelector('details[data-folder="people"]').open);
    await page.locator('button[data-direction="c"]').click();
    await page.getByRole('button', {name: '记录一次互动', exact: true}).click();
    await page.getByLabel('互动记录').fill('试了最小方案，下次核对人脉模板。');
    await page.getByRole('button', {name: '保存互动', exact: true}).click();
    await page.getByText('试了最小方案，下次核对人脉模板。', {exact: true}).waitFor();
    await page.locator('button[data-direction="a"]').click();
    assert(await page.getByText('试了最小方案，下次核对人脉模板。', {exact: true}).isVisible());
    await page.reload();
    assert(await page.getByText('试了最小方案，下次核对人脉模板。', {exact: true}).isVisible());
    assert.equal(await page.locator('details[data-folder="people"]').getAttribute('open'), null);
    await page.getByRole('button', {name: '记录一次互动', exact: true}).click();
    await page.getByLabel('互动记录').fill('  ');
    await page.getByRole('button', {name: '保存互动', exact: true}).click();
    await page.getByText('请先写下互动记录。', {exact: true}).waitFor();
    await page.getByRole('button', {name: '取消记录', exact: true}).click();
    await page.getByRole('button', {name: '查看原文件', exact: true}).click();
    await page.getByRole('dialog').waitFor({state: 'visible'});
    assert.match(await page.getByLabel('原文件内容').inputValue(), /试了最小方案/);
    await page.keyboard.press('Escape');
    assert(await page.getByRole('button', {name: '查看原文件', exact: true}).evaluate(e => e === document.activeElement));
    await page.getByRole('button', {name: '回响', exact: true}).click();
    await page.getByLabel('私人观察').fill('这是私人观察，不进入本次材料。');
    await page.getByRole('button', {name: '记下观察', exact: true}).click();
    await page.getByText('已记下，仅留给自己', {exact: true}).waitFor();
    await page.getByRole('button', {name: '准备给 Agent', exact: true}).click();
    await page.getByRole('button', {name: '查看带走的内容', exact: true}).click();
    assert.doesNotMatch(await page.getByLabel('材料预览').inputValue(), /这是私人观察/);
    await page.getByRole('button', {name: '关闭辅助内容', exact: true}).click();
    await page.getByRole('button', {name: '空间', exact: true}).click();
    await page.getByRole('button', {name: '切换深色主题', exact: true}).click();
    assert(await page.locator('button[data-direction="a"]').evaluate(el => {
      const expected = document.createElement('span');
      expected.style.backgroundColor = 'var(--surface)';
      document.body.append(expected);
      const correct = getComputedStyle(expected).backgroundColor === getComputedStyle(el).backgroundColor;
      expected.remove(); return correct;
    }), 'Selected tab follows the dark surface immediately');
    await page.screenshot({path: '/tmp/mindos-directions-dark.png', fullPage: true});
    await page.goto(base + '#invalid/unknown');
    await page.waitForFunction(() => document.querySelector('#app-frame').dataset.direction === 'a');
    assert(await page.getByRole('heading', {name: '林若舟', exact: true}).isVisible());
    await page.locator('button[data-direction="a"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#app-frame').dataset.direction === 'b');
    assert.equal(await page.locator('button[data-direction="b"]').getAttribute('aria-selected'), 'true');
    await page.getByRole('button', {name: '工作台', exact: true}).click();
    await page.getByRole('heading', {name: 'MindOS 产品打磨', exact: true}).waitFor();
    await page.getByRole('button', {name: '用人脉视图查看', exact: true}).click();
    await page.getByRole('table', {name: '示例人物与下次跟进'}).waitFor();
    assert.equal(await page.getByRole('table', {name: '示例人物与下次跟进'}).getByRole('row').count(), 4);
    await page.getByRole('table').getByRole('button', {name: /陈以安/}).click();
    await page.getByRole('heading', {name: '陈以安', exact: true}).waitFor();
    await page.getByRole('button', {name: '准备给 Agent', exact: true}).click();
    await page.getByRole('button', {name: '查看带走的内容', exact: true}).click();
    assert.match(await page.getByLabel('材料预览').inputValue(), /陈以安/);
    assert.doesNotMatch(await page.getByLabel('材料预览').inputValue(), /试了最小方案/);

    const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, deviceScaleFactor: 1});
    const m = await mobile.newPage();
    for (const width of [390, 320, 1024, 1440]) {
      await m.setViewportSize({width, height: 900});
      for (const direction of ['a','b','c']) {
        await m.goto(base + '#' + direction + '/reading');
        await m.waitForFunction(d => document.querySelector('#app-frame')?.dataset.direction === d, direction);
        assert(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${direction} / ${width}px does not overflow`);
        if (width === 390) await m.screenshot({path: `/tmp/mindos-directions-${direction}-mobile.png`, fullPage: true});
      }
    }
    await m.setViewportSize({width: 390, height: 844});
    await m.getByRole('button', {name: '打开目录', exact: true}).click();
    await m.getByRole('dialog', {name: '示例目录'}).waitFor();
    await m.getByRole('dialog').getByRole('button', {name: '林若舟.md', exact: true}).click();
    await m.getByRole('dialog').waitFor({state: 'hidden'});
    assert(await m.getByRole('heading', {name: '林若舟', exact: true}).isVisible());

    const broken = await browser.newContext();
    await broken.addInitScript(() => {
      Storage.prototype.setItem = () => {throw new Error('blocked');};
      Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.reject(new Error('blocked'))}});
    });
    const b = await broken.newPage();
    await b.goto(base);
    await b.getByText('示例存储不可用；刷新后本页修改不会保留。', {exact: true}).waitFor();
    await b.getByRole('button', {name: '准备给 Agent', exact: true}).click();
    await b.getByRole('button', {name: '查看带走的内容', exact: true}).click();
    await b.getByRole('button', {name: '复制材料', exact: true}).click();
    await b.getByText('复制失败，请在预览中选取内容后手动复制。', {exact: true}).waitFor();
    const reduced = await browser.newContext({reducedMotion: 'reduce'});
    const r = await reduced.newPage();
    await r.goto(base);
    assert(await r.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    assert.equal(await r.locator('button[data-direction="a"]').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({status: 'passed', checks: ['three layouts and shared content', 'draft preservation and confirmed version', 'judgment and context preview', 'real clipboard success/error', 'Agent focus and preview invalidation', 'folder expansion and refresh', 'private observation exclusion', 'interaction and refresh', 'empty input', 'raw file and focus return', 'theme', 'invalid route', 'keyboard', '390/320/1024/1440px', 'mobile directory', 'blocked storage'], screenshots: '/tmp/mindos-directions-*.png'}, null, 2));
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exit(1);});
