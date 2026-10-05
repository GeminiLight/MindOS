import { expect, test } from '@playwright/test';

test('Mind Home gives search a visible label and keeps both next actions readable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/wiki');

  const home = page.locator('[data-content-page-shell="wiki"]');
  const ask = home.getByRole('button', { name: 'Ask MindOS about your notes' });
  await expect(ask).toBeVisible();
  const search = home.getByRole('button', { name: 'Search', exact: true });
  await expect(search).toBeVisible();
  await expect(search).toContainText('Search');

  const create = home.getByRole('link', { name: 'New note', exact: true });
  const createLabel = create.getByText('New note', { exact: true });
  const resume = home.getByRole('link', { name: /Continue editing/ });
  const resumeLabel = resume.getByText('Continue editing');
  const fileName = resume.locator('span').last();
  await expect(create).toBeVisible();
  await expect(resume).toBeVisible();
  expect((await fileName.textContent())?.trim().length).toBeGreaterThan(0);
  const [createTextBox, resumeTextBox, fileNameBox] = await Promise.all([
    createLabel.boundingBox(), resumeLabel.boundingBox(), fileName.boundingBox(),
  ]);
  expect(createTextBox?.height).toBeLessThanOrEqual(22);
  expect(fileNameBox && resumeTextBox && fileNameBox.y >= resumeTextBox.y + resumeTextBox.height - 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await page.screenshot({ path: '/tmp/mindos-wiki-home-command-320-en.png', animations: 'disabled' });
  await fileName.evaluate(element => { element.textContent = '研究笔记🌿'.repeat(40) + '.md'; });
  expect(await fileName.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(resumeLabel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await ask.click();
  await expect(page.getByRole('dialog', { name: 'MindOS' })).toBeVisible();
  await page.goto('/wiki');
  await search.click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
});

test('Chinese dark Mind Home presents search and a resumable note without crowding', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => {
    localStorage.setItem('locale', 'zh');
    localStorage.setItem('theme', 'dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/wiki');

  const home = page.locator('[data-content-page-shell="wiki"]');
  await expect(home.getByRole('button', { name: '向 MindOS 提问' })).toBeVisible();
  await expect(home.getByRole('button', { name: '搜索', exact: true })).toContainText('搜索');
  await expect(home.getByRole('link', { name: '新建笔记' })).toBeVisible();
  const resume = home.getByRole('link', { name: /继续编辑/ });
  await expect(resume.locator('span').last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '/tmp/mindos-wiki-home-command-390-zh-dark.png', animations: 'disabled' });
});
