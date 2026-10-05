// Manual browser checks for the standalone research page; start its static server first.
const { chromium } = require('../../../node_modules/@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.MINDOS_REFERENCE_URL || 'http://127.0.0.1:4599/';
const hunt = ['capacities', 'mymind', 'heptabase', 'tana', 'fabric', 'recall'];
const original = ['obsidian', 'pieces', 'reader', 'notion', 'attio', 'claude', 'linear'];

async function imageReady(page) {
  await page.waitForFunction(() => {
    const img = document.querySelector('#image-stage img');
    return img?.complete && img.naturalWidth > 0 && document.querySelector('#zoom-image')?.disabled === false;
  });
}

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1060}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '#hunt');
    // The selection must be its own chapter, with a working route and six sourced studies.
    assert.equal(await page.locator('#hunt').count(), 1, 'Product Hunt chapter exists');
    await page.locator('#hunt').waitFor({state: 'visible'});
    assert.equal(await page.locator('.hunt-card').count(), 6);
    assert.equal(await page.locator('.watch-row').count(), 3);
    await page.waitForFunction(() => [...document.querySelectorAll('.hunt-card img')].every(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({path: '/tmp/mindos-product-hunt-desktop.png', fullPage: true});
    await page.screenshot({path: '/tmp/mindos-product-hunt-preview.png'});
    await page.locator('[data-product-link="capacities"]').first().click();
    await page.waitForURL('**/#atlas/capacities');
    await page.getByRole('heading', {name: 'Capacities', exact: true}).waitFor();
    assert.equal(await page.locator('#product-nav button:visible').count(), 6);
    assert.equal(await page.locator('[data-collection="hunt"]').getAttribute('aria-pressed'), 'true');
    await imageReady(page);
    await page.locator('#zoom-image').click();
    await page.getByRole('dialog').waitFor({state: 'visible'});
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => document.activeElement.id), 'zoom-image');
    await page.locator('[data-collection="base"]').click();
    await page.getByRole('heading', {name: 'Obsidian', exact: true}).waitFor();
    assert.equal(await page.locator('#product-nav button:visible').count(), 7);

    let images = 0;
    for (const id of [...hunt, ...original]) {
      await page.goto(base + '#atlas/' + id);
      await imageReady(page);
      const count = await page.locator('[data-image]').count();
      for (let i = 0; i < count; i++) {
        if (count > 1) await page.locator('[data-image]').nth(i).click();
        await imageReady(page);
        images++;
      }
      assert.equal(await page.locator('#product-nav [aria-pressed="true"]').getAttribute('data-product'), id);
      if (id === 'heptabase') await page.screenshot({path: '/tmp/mindos-product-hunt-heptabase.png', fullPage: true});
    }
    // Keyboard traversal must stay within the selected collection.
    await page.goto(base + '#atlas/recall');
    await page.locator('[data-product="recall"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForURL('**/#atlas/capacities');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.product), 'capacities');
    await page.locator('#tab-atlas').focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('#hunt').waitFor({state: 'visible'});
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('#hunt').isVisible(), 'skip link preserves the active chapter');
    await page.goto(base + '#atlas/missing-product');
    await page.getByRole('heading', {name: 'Obsidian', exact: true}).waitFor();
    await page.goto(base + '#missing-section');
    assert(await page.locator('#atlas').isVisible());
    await page.goto(base + '#comparison');
    assert.equal(await page.locator('#comparison-rows tr').count(), 4);
    await page.goto(base + '#recommendations');
    assert.equal(await page.locator('.recommendation-list > li').count(), 3);
    await page.goto(base + '#sources');
    assert.equal(await page.locator('#source-list .source-row').count(), 16);

    // New image types must recover from failure, including an explicit retry.
    let fail = true;
    const offline = await browser.newContext();
    await offline.route('**/images/hunt/capacities-overview.jpg', route => fail ? route.abort('failed') : route.continue());
    const failedPage = await offline.newPage();
    await failedPage.goto(base + '#atlas/capacities');
    await failedPage.getByRole('button', {name: '重新加载图片'}).waitFor();
    assert.equal(await failedPage.locator('#zoom-image').isEnabled(), false);
    assert(await failedPage.getByRole('link', {name: '查看官方原始材料', exact: true}).isVisible());
    await failedPage.screenshot({path: '/tmp/mindos-product-hunt-error.png'});
    fail = false;
    await failedPage.getByRole('button', {name: '重新加载图片'}).click();
    await imageReady(failedPage);
    assert(await failedPage.locator('#zoom-image').isEnabled());

    const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, deviceScaleFactor: 1});
    const m = await mobile.newPage();
    for (const width of [390, 320]) {
      await m.setViewportSize({width, height: 844});
      for (const route of ['hunt', 'atlas/recall', 'comparison', 'recommendations', 'sources']) {
        await m.goto(base + '#' + route);
        await m.locator('#' + route.split('/')[0]).waitFor({state: 'visible'});
        assert(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px / ${route} does not overflow`);
        if (route === 'atlas/recall') {
          await imageReady(m);
          assert(await m.locator('[data-product="recall"]').evaluate(e => {const box = e.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;}), `${width}px / selected product remains visible after returning to atlas`);
        }
        if (route === 'hunt' && width === 390) {
          await m.waitForFunction(() => [...document.querySelectorAll('.hunt-card img')].every(img => img.complete && img.naturalWidth > 0));
          await m.screenshot({path: '/tmp/mindos-product-hunt-mobile.png', fullPage: true});
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({status: 'passed', products: 13, images, watchlist: 3, checks: ['deep links', 'collection navigation', 'keyboard', 'zoom and focus return', 'invalid routes', '390/320px layouts', 'image error and retry'], screenshots: '/tmp/mindos-product-hunt-*.png'}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exit(1);});
