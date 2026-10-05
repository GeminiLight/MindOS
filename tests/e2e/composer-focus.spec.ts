import { expect, test } from '@playwright/test';

for (const { theme, width, locale, path, surface } of [
  { theme: 'light', width: 1440, locale: 'en', path: '/', surface: 'home' },
  { theme: 'dark', width: 390, locale: 'zh', path: '/', surface: 'home' },
] as const) {
  test(`${surface} composer stays readable and calm in ${theme} ${locale} at ${width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }]);
    await page.addInitScript(({ themeName, localeName }) => {
      localStorage.setItem('theme', themeName);
      localStorage.setItem('locale', localeName);
    }, { themeName: theme, localeName: locale });
    await page.goto(path);
    await expect(page.getByRole('heading', { name: locale === 'zh' ? '继续你的工作' : 'Continue your work' })).toBeVisible();

    const input = page.locator('textarea.ask-composer-input').first();
    await expect(input).toBeVisible();
    const typography = await input.evaluate(element => {
      const placeholder = getComputedStyle(element, '::placeholder');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.fillStyle = placeholder.color;
      context.fillRect(0, 0, 1, 1);
      return {
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        placeholderAlpha: context.getImageData(0, 0, 1, 1).data[3] / 255,
      };
    });
    expect(typography.fontSize).toBeGreaterThanOrEqual(width < 768 ? 16 : 14);
    expect(typography.placeholderAlpha).toBeGreaterThanOrEqual(0.9);
    const unfocusedBounds = await input.boundingBox();
    await input.click();
    await expect(input).toBeFocused();
    const focusedBounds = await input.boundingBox();
    // This isolates focus-driven geometry; the Home readiness test separately
    // checks that the initial model-status update does not move the input.
    expect(focusedBounds?.x).toBe(unfocusedBounds?.x);
    expect(focusedBounds?.width).toBe(unfocusedBounds?.width);
    expect(focusedBounds?.height).toBe(unfocusedBounds?.height);

    const focused = await input.evaluate(element => {
      const style = getComputedStyle(element);
      const card = element.closest('.ask-composer-card');
      return {
        outlineStyle: style.outlineStyle,
        radius: Number.parseFloat(style.borderTopLeftRadius),
        shadow: style.boxShadow,
        cardBorder: card ? getComputedStyle(card).borderTopColor : null,
      };
    });
    expect(focused.outlineStyle).toBe('none');
    expect(focused.radius).toBeGreaterThanOrEqual(8);
    expect(focused.shadow).toBe('none');
    // Pointer placement should not draw an amber frame around the whole
    // composer. Keyboard entry still needs a visible focus cue.
    expect(focused.cardBorder).toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `/tmp/mindos-composer-pointer-${surface}-${theme}-${locale}-${width}.png`, animations: 'disabled' });

    await page.keyboard.press('Shift+Tab');
    await expect(input).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    expect(await input.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
    await expect.poll(() => input.evaluate(element => getComputedStyle(element.closest('.ask-composer-card')!).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');

    await page.screenshot({ path: `/tmp/mindos-composer-focus-${surface}-${theme}-${locale}-${width}.png`, animations: 'disabled' });

    const longPrompt = '共同进化需要在人与智能体之间建立可验证的学习循环。'.repeat(70);
    await input.fill(longPrompt);
    await expect(input).toHaveValue(longPrompt);
    const send = page.locator('form:has(textarea.ask-composer-input) button[type="submit"]').first();
    await expect(send).toBeVisible();
    const inputBox = await input.boundingBox();
    const sendBox = await send.boundingBox();
    expect(inputBox && sendBox && inputBox.x + inputBox.width <= sendBox.x + 1).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    if (width < 768) {
      await page.screenshot({ path: '/tmp/mindos-composer-long-zh-390.png', animations: 'disabled' });
      const mobileHeight = await input.evaluate(element => element.getBoundingClientRect().height);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect.poll(() => input.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(mobileHeight - 4);
    }

    await input.evaluate(element => (element as HTMLTextAreaElement).blur());
    await expect(input).not.toBeFocused();
    await expect.poll(() => input.evaluate(element => getComputedStyle(element.closest('.ask-composer-card')!).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
  });
}

test('docked MindOS composer focuses the rounded card without an inner rectangle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/capture');
  await page.getByRole('button', { name: /Ask MindOS/ }).click();
  const panel = page.getByRole('complementary', { name: 'MindOS panel' });
  await expect(panel).toBeVisible();
  const input = panel.locator('textarea.ask-composer-input');
  await input.click();
  await expect(input).toBeFocused();
  const style = await input.evaluate(element => ({
    outline: getComputedStyle(element).outlineStyle,
    shadow: getComputedStyle(element).boxShadow,
    cardRadius: Number.parseFloat(getComputedStyle(element.closest('.ask-composer-card')!).borderTopLeftRadius),
  }));
  expect(style.outline).toBe('none');
  expect(style.shadow).toBe('none');
  expect(style.cardRadius).toBeGreaterThanOrEqual(12);
  await expect.poll(() => input.evaluate(element => getComputedStyle(element.closest('.ask-composer-card')!).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
  await panel.screenshot({ path: '/tmp/mindos-composer-focus-docked-panel.png', animations: 'disabled' });
});

test('touch placement keeps the composer unframed on mobile', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    const input = page.locator('textarea.ask-composer-input').first();
    await expect(input).toBeVisible();
    await input.tap();
    await expect(input).toBeFocused();
    await expect.poll(() => input.evaluate(element => getComputedStyle(element.closest('.ask-composer-card')!).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: '/tmp/mindos-composer-touch-390.png', animations: 'disabled' });
  } finally {
    await context.close();
  }
});

for (const { theme, width, locale } of [
  { theme: 'light', width: 1440, locale: 'en' },
  { theme: 'dark', width: 390, locale: 'zh' },
] as const) {
  test(`Inbox capture focuses the whole card without a heavy text rectangle in ${theme} ${locale}`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }]);
    await page.addInitScript(({ themeName, localeName }) => {
      localStorage.setItem('theme', themeName);
      localStorage.setItem('locale', localeName);
    }, { themeName: theme, localeName: locale });
    await page.goto('/capture');

    const input = page.locator('#inbox-capture-input');
    await expect(input).toBeVisible();
    const card = page.locator('[data-inbox-composer-card]');
    const before = await card.evaluate(element => getComputedStyle(element).borderTopColor);
    await input.click();
    await expect(input).toBeFocused();
    const focused = await input.evaluate(element => {
      const field = getComputedStyle(element);
      const shell = getComputedStyle(element.closest('[data-inbox-composer-card]')!);
      return {
        outline: field.outlineStyle,
        shadow: field.boxShadow,
        cardRadius: Number.parseFloat(shell.borderTopLeftRadius),
      };
    });
    expect(focused.outline).toBe('none');
    expect(focused.shadow).toBe('none');
    expect(focused.cardRadius).toBeGreaterThanOrEqual(14);
    await expect.poll(() => card.evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe(before);

    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await input.fill(locale === 'zh' ? '下一轮访谈的判断依据' : 'Reasoning evidence for the next interview');
    await expect(page.getByRole('button', { name: locale === 'zh' ? '保存到收集箱' : 'Save to Inbox' })).toBeEnabled();
    await expect(page.locator('[data-capture-draft-status] svg.lucide-check')).toBeVisible();
    await page.screenshot({ path: `/tmp/mindos-inbox-capture-focus-${theme}-${locale}-${width}.png`, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await input.blur();
    await expect.poll(() => card.evaluate(element => getComputedStyle(element).borderTopColor)).toBe(before);
  });
}

test('Inbox capture retains a usable input when its queue request fails', async ({ page }) => {
  await page.route('**/api/inbox**', route => route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }));
  await page.goto('/capture');
  const input = page.locator('#inbox-capture-input');
  await expect(input).toBeVisible();
  await input.fill('Keep this draft while the queue is unavailable');
  await expect(input).toHaveValue('Keep this draft while the queue is unavailable');
  expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
});

test('a focused capture keeps the stronger drop-target cue when a file is dragged over it', async ({ page }) => {
  await page.goto('/capture');
  const input = page.locator('#inbox-capture-input');
  await expect(input).toBeVisible();
  await input.click();
  const card = page.locator('[data-inbox-composer-card]');
  await card.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['draft'], 'draft.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(card).toHaveAttribute('data-drag-over', 'true');
  const amber = await card.evaluate(() => {
    const swatch = document.createElement('div');
    swatch.style.color = 'var(--amber)';
    document.body.append(swatch);
    const color = getComputedStyle(swatch).color;
    swatch.remove();
    return color;
  });
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).borderTopColor)).toBe(amber);
});
