import { test, expect as baseExpect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
const expect = baseExpect.configure({ timeout: 20_000 });

// Run against an isolated knowledge root: MINDOS_URL=http://localhost:4570 pnpm test:e2e studio-views.spec.ts
// Explicit opt-in prevents creating test records in the user's ordinary library.
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== '1',
  'Requires the isolated Views preview server',
);
test.setTimeout(180_000);
test('a view maintains original records, recovers drafts and prepares selected materials', async ({
  page,
  request,
}) => {
  const index = await (await request.get('/api/views')).json();
  const folder = `验证/人脉-${randomUUID()}`;
  await page.context().addCookies([
    {
      name: 'locale',
      value: 'zh',
      url: process.env.MINDOS_URL ?? 'http://localhost:4570',
    },
  ]);
  await page.addInitScript(() => {
    if (!localStorage.getItem('locale')) localStorage.setItem('locale', 'zh');
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto('/studio/views', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: '视图', exact: true }),
  ).toBeVisible();
  const template = page.getByRole('button', {
    name: /使用人脉模板|使用模板/,
    exact: true,
  });
  await template.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('视图名称').fill('真实人脉验证');
  await dialog.getByLabel('资料位置', { exact: true }).fill(folder);
  await page.screenshot({ path: '/tmp/studio-views-create.png' });
  await dialog.getByRole('button', { name: '创建视图', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/views\/v-/);
  await expect(
    page.getByRole('heading', { name: '从第一位联系人开始' }),
  ).toBeVisible();
  await page.screenshot({ path: '/tmp/studio-views-empty.png' });
  await page
    .getByRole('button', { name: '新建人物', exact: true })
    .first()
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('姓名', { exact: true }).fill('叶遥');
  await dialog
    .getByLabel('背景', { exact: true })
    .fill('独立研究者。在读书会认识。');
  await dialog
    .getByLabel('关注方向', { exact: true })
    .fill('AI 工具与人的判断');
  await dialog.getByRole('button', { name: '保存人物', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '叶遥', exact: true }),
  ).toBeVisible();
  const viewId = new URL(page.url()).pathname.split('/').pop()!;
  const collection = await (
    await request.get(`/api/views?op=read&rootId=${index.rootId}&id=${viewId}`)
  ).json();
  const person = collection.people[0];
  const original = await (
    await request.get('/api/views', {
      params: {
        op: 'raw',
        rootId: index.rootId,
        id: viewId,
        path: person.path,
      },
    })
  ).json();
  expect(original.content).toContain('# 叶遥');
  await page.getByRole('button', { name: '记录互动', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('聊了什么', { exact: true })
    .fill('下周一起核对工作台的资料组织。');
  await dialog
    .getByLabel('关联来源（可选）', { exact: true })
    .fill('读书会笔记');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '记录互动', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('聊了什么', { exact: true })).toHaveValue(
    '下周一起核对工作台的资料组织。',
  );
  await expect(dialog.getByText('已恢复未保存的草稿。')).toBeVisible();
  await dialog.getByRole('button', { name: '保存互动', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByText('下周一起核对工作台的资料组织。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '安排跟进', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('下一步', { exact: true }).fill('分享视图的使用反馈');
  await dialog.getByLabel('计划日期', { exact: true }).fill('2026-10-20');
  await dialog.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByText('分享视图的使用反馈', { exact: true }).last(),
  ).toBeVisible();
  // Change the file through the same public write boundary while a human holds an unsaved edit.
  await page.getByRole('button', { name: '修改资料', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('背景', { exact: true }).fill('保留的人工修改');
  const current = await (
    await request.get('/api/views', {
      params: {
        op: 'raw',
        rootId: index.rootId,
        id: viewId,
        path: person.path,
      },
    })
  ).json();
  const external = await request.post('/api/file', {
    data: {
      op: 'save_file',
      path: person.path,
      content: current.content + '\n## 私人反思\nPRIVATE_ONLY\n',
      expectedRevision: current.revision,
      expectedRootId: index.rootId,
    },
  });
  expect(external.ok()).toBe(true);
  await dialog.getByRole('button', { name: '保存人物', exact: true }).click();
  await expect(dialog.getByText('原资料已在别处更新')).toBeVisible();
  await expect(dialog.getByLabel('背景', { exact: true })).toHaveValue(
    '保留的人工修改',
  );
  await dialog
    .getByRole('button', { name: '查看最新版本', exact: true })
    .click();
  await expect(dialog.getByText('当前保存版本', { exact: true })).toBeVisible();
  await dialog
    .getByRole('button', { name: '核对后保留我的修改', exact: true })
    .click();
  await dialog.getByRole('button', { name: '保存人物', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('保留的人工修改', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/studio-views-person-light.png' });
  await page.getByRole('button', { name: '会前准备', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('互动记录', { exact: true }).uncheck();
  await dialog
    .getByRole('button', { name: '预览准备材料', exact: true })
    .click();
  const preview = dialog.getByRole('textbox', {
    name: '预览准备材料',
    exact: true,
  });
  await expect(preview).toHaveValue(/保留的人工修改/);
  await expect(preview).not.toHaveValue(/下周一起核对/);
  await expect(preview).not.toHaveValue(/PRIVATE_ONLY/);
  await page.screenshot({ path: '/tmp/studio-views-preparation.png' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(
      async () =>
        (await page
          .locator('[data-content-page-shell="studio"]')
          .boundingBox())!.x,
    )
    .toBeLessThan(40);
  await page.screenshot({ path: '/tmp/studio-views-person-mobile.png' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '返回联系人', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '查找人物' })).toBeVisible();
  await page.screenshot({ path: '/tmp/studio-views-list-mobile.png' });
  await page.getByRole('button', { name: /叶遥/ }).click();
  await expect(
    page.getByRole('heading', { name: '叶遥', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: '叶遥', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: '/tmp/studio-views-person-dark.png' });
  // Removing the entry must leave the source untouched.
  await page.getByRole('button', { name: '管理视图', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '移除视图', exact: true }).click();
  await dialog.getByRole('button', { name: '移除视图', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/views$/);
  const remaining = await (
    await request.get('/api/file', { params: { path: person.path } })
  ).json();
  expect(JSON.stringify(remaining)).toContain('PRIVATE_ONLY');
  expect(JSON.stringify(remaining)).toContain('保留的人工修改');
});

test('associates existing files, renames the view, exports and stays usable at 320px', async ({
  page,
  request,
}) => {
  const { rootId } = await (await request.get('/api/views')).json();
  const folder = `验证/既有资料-${randomUUID()}`;
  const csv = '姓名,备注\n原始资料,必须保留\n';
  for (const [path, content] of [
    [
      `${folder}/人物/叶遥.md`,
      '# 叶遥\n\n## 背景\n独立研究者\n\n## 私人反思\nPRIVATE_EXISTING\n\n## 互动记录\n- 2026-10-01：讨论资料管理。\n',
    ],
    [`${folder}/关系.csv`, csv],
  ]) {
    const response = await request.post('/api/file', {
      data: {
        op: 'create_file',
        path,
        content,
        source: 'user',
        expectedRootId: rootId,
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.context().addCookies([
    {
      name: 'locale',
      value: 'zh',
      url: process.env.MINDOS_URL ?? 'http://localhost:4570',
    },
  ]);
  await page.addInitScript(() => {
    if (!localStorage.getItem('locale')) localStorage.setItem('locale', 'zh');
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto('/studio/views', { waitUntil: 'domcontentloaded' });
  const templateButton = page.getByRole('button', {
    name: /使用人脉模板|使用模板/,
  });
  const retryButton = page.getByRole('button', { name: '重试', exact: true });
  await expect(templateButton.or(retryButton)).toBeVisible();
  if (await retryButton.isVisible()) await retryButton.click();
  await templateButton.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /关联已有资料/ }).check();
  await dialog.getByLabel('视图名称').fill('已有资料验证');
  await dialog.getByLabel('资料位置', { exact: true }).fill(folder);
  await expect(
    dialog.getByRole('button', { name: '创建视图', exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByText('叶遥', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/studio-views-existing.png' });
  await dialog.getByRole('button', { name: '创建视图', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '叶遥', exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop()!;
  await page.getByRole('button', { name: '管理视图', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('视图名称').fill('研究伙伴');
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '研究伙伴', exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出关系总览', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('people.csv');
  await download.saveAs('/tmp/studio-views-export.csv');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '关系.csv', exact: true }).click();
  await expect(page.locator('pre')).toContainText('必须保留');
  await expect(
    page.getByRole('button', { name: '打开文件编辑器' }),
  ).toHaveAttribute('href', /关系.csv|%E5%85%B3/);
  const original = await (
    await request.get('/api/views', {
      params: { op: 'raw', rootId, id, path: `${folder}/关系.csv` },
    })
  ).json();
  expect(original.content).toBe(csv);
  await page.getByRole('button', { name: '人脉视图', exact: true }).click();
  await page.getByRole('button', { name: /叶遥/ }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(
      async () =>
        (await page
          .locator('[data-content-page-shell="studio"]')
          .boundingBox())!.x,
    )
    .toBeLessThan(40);
  await expect(
    page.getByRole('button', { name: '会前准备', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '/tmp/studio-views-person-320.png' });
  // Keyboard focus must stay inside a dialog, Escape returns to the original action.
  await page.getByRole('button', { name: '修改资料', exact: true }).click();
  await expect(page.getByLabel('姓名', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('背景', { exact: true })).toBeFocused();
  await page.screenshot({ path: '/tmp/studio-views-editor-focus-320.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '修改资料', exact: true }),
  ).toBeFocused();
  await page.evaluate(() => {
    localStorage.setItem('locale', 'en');
    localStorage.setItem('theme', 'dark');
    document.cookie = 'locale=en;path=/';
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', { name: 'Meeting preparation', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: '/tmp/studio-views-person-en-dark-320.png' });
  await page
    .getByRole('button', { name: 'Meeting preparation', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Preview materials', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '/tmp/studio-views-preparation-en-320.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage view', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Remove view', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Remove view', exact: true })
    .click();
  await expect(page).toHaveURL(/\/studio\/views$/);
});

test('an open template cannot carry its old draft into another knowledge library', async ({
  page,
  request,
}) => {
  const configPath = process.env.MINDOS_VIEWS_TEST_CONFIG ?? '/tmp/mindos-views-preview/home/.mindos/config.json';
  const original = readFileSync(configPath, 'utf8');
  const config = JSON.parse(original);
  expect(config.mindRoot).toBe(process.env.MINDOS_VIEWS_TEST_ROOT ?? '/tmp/mindos-views-preview/knowledge');
  const old = await (await request.get('/api/views')).json();
  expect(old.rootId).toMatch(/^[a-f0-9]{24}$/);
  const other = mkdtempSync('/tmp/mindos-views-switch-');
  try {
    await page
      .context()
      .addCookies([
        {
          name: 'locale',
          value: 'zh',
          url: process.env.MINDOS_URL ?? 'http://localhost:4570',
        },
      ]);
    await page.addInitScript(() => localStorage.setItem('locale', 'zh'));
    await page.goto('/studio/views', { waitUntil: 'domcontentloaded' });
    const template = page.getByRole('button', {
      name: /使用人脉模板|使用模板/,
    });
    const retry = page.getByRole('button', { name: '重试', exact: true });
    await expect(template.or(retry)).toBeVisible();
    if (await retry.isVisible()) await retry.click();
    await template.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('视图名称').fill('旧库的视图');
    await dialog.getByLabel('资料位置', { exact: true }).fill('不应跨库');
    writeFileSync(configPath, JSON.stringify({ ...config, mindRoot: other }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      dialog.getByText('知识库发生变化，草稿已保留。请重新读取当前知识库。'),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '创建视图', exact: true }),
    ).toBeDisabled();
    // Bypass the button to verify the same guard protects Enter and programmatic form submission.
    await dialog
      .locator('form')
      .evaluate((form) =>
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
      );
    expect(existsSync(join(other, '不应跨库'))).toBe(false);
    const next = await (await request.get('/api/views')).json();
    expect(next.rootId).not.toBe(old.rootId);
    expect(next.views).toEqual([]);
    expect(
      await page.evaluate(
        (rootId) =>
          Object.keys(localStorage).some(
            (key) =>
              key.startsWith('mindos:view-draft:') && key.includes(rootId),
          ),
        old.rootId,
      ),
    ).toBe(true);
    await page.screenshot({ path: '/tmp/studio-views-root-switch.png' });
    await expect(
      dialog.getByRole('button', { name: '取消', exact: true }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    writeFileSync(configPath, original);
    rmSync(other, { recursive: true, force: true });
  }
});
