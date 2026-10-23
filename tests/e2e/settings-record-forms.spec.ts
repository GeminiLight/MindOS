import { test, expect } from "@playwright/test";
import { pageFixture } from "../helpers/pages-fixture";

test.skip(process.env.MINDOS_VIEWS_ISOLATED !== "1", "Use the disposable Views runner");
for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`settings and record forms recover from failed saves in ${theme} at ${width}px`, async ({ page, context, request, baseURL }) => {
      const f = await pageFixture(request);
      await page.setViewportSize({ width, height: 1000 });
      await context.addCookies([{ name: "locale", value: "zh", url: baseURL! }]);
      await page.addInitScript(theme => { localStorage.setItem("locale", "zh"); localStorage.setItem("theme", theme); }, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const pageErrors: string[] = [];
      page.on("pageerror", e => pageErrors.push(e.message));
      // Only intercept writes to reproduce a network failure; retries reach the real local server.
      let rejectSettings = true;
      await page.route("**/api/settings", async route => {
        if (route.request().method() === "POST" && rejectSettings) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporarily offline" }) });
        } else await route.continue();
      });
      await page.goto("/settings?tab=ai");
      const steps = page.getByRole("combobox", { name: "最大步数", exact: true });
      await steps.focus();
      expect(await steps.evaluate(el => getComputedStyle(el).outlineOffset)).toBe("-1px");
      await steps.click();
      await page.getByRole("option", { name: "20", exact: true }).click();
      const settingsState = page.locator("[data-settings-save-state]");
      await expect(settingsState).toContainText("保存失败");
      await expect(settingsState).toHaveAttribute("role", "alert");
      await expect(steps).toContainText("20");
      await page.screenshot({ path: `/tmp/mindos-settings-error-${theme}-${width}.png` });
      rejectSettings = false;
      await settingsState.getByRole("button", { name: "重试保存" }).click();
      await expect(settingsState).toContainText("已保存");
      expect((await (await request.get("/api/settings")).json()).agent.maxSteps).toBe(20);
      await page.reload();
      await expect(steps).toContainText("20");
      await page.goto("/settings?tab=knowledge");
      const secret = page.getByLabel("网页访问密码", { exact: true });
      // Read-only focus check: never change credentials even in the temporary fixture.
      await secret.focus();
      const edge = await secret.evaluate(el => ({ offset: getComputedStyle(el).outlineOffset, parent: getComputedStyle(el.parentElement!).boxShadow }));
      expect(edge.offset).toBe("-1px");
      expect(edge.parent).toBe("none");
      await expect(page.getByRole("button", { name: "更新端口", exact: true })).toBeDisabled();
      await page.screenshot({ path: `/tmp/mindos-settings-focus-${theme}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

      await page.keyboard.press("Control+,");
      const settingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
      await expect(settingsDialog).toBeVisible();
      await settingsDialog.getByRole("combobox", { name: "最大步数", exact: true }).focus();
      await page.screenshot({ path: `/tmp/mindos-settings-dialog-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await expect(settingsDialog).toHaveCount(0);

      const created = await f.post("page.save", { expectedVersion: 0, spec: f.spec, operationId: crypto.randomUUID() });
      await page.goto("/studio/pages/" + created.page.id);
      await page.getByRole("button", { name: "评审工作台原型", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "编辑任务", exact: true });
      const title = dialog.getByLabel("任务", { exact: true });
      await title.fill("   ");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await expect(title).toHaveAttribute("aria-invalid", "true");
      await title.fill(`收集反馈 ${theme}-${width}`);
      await expect(title).not.toHaveAttribute("aria-invalid", "true");
      let failTask = true;
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/api/views/v2", async route => {
        if (route.request().method() === "POST" && route.request().postDataJSON()?.op === "mutate") {
          if (failTask) {
            await gate;
            await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "暂时无法保存，请重试" }) });
          } else await route.continue();
        } else await route.continue();
      });
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await expect(dialog.locator("form")).toHaveAttribute("aria-busy", "true");
      await expect(title).toBeDisabled();
      await expect(dialog.getByRole("combobox", { name: "人物资料夹", exact: true })).toBeDisabled();
      await expect(dialog.locator('[data-slot="dialog-close"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await page.screenshot({ path: `/tmp/mindos-task-saving-${theme}-${width}.png` });
      release();
      await expect(dialog.getByRole("alert")).toContainText("暂时无法保存");
      await expect(title).toBeEnabled();
      await expect(title).toHaveValue(`收集反馈 ${theme}-${width}`);
      await page.screenshot({ path: `/tmp/mindos-task-error-${theme}-${width}.png` });
      failTask = false;
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect((await f.read(f.tasks.collection.id)).records[0].fields.title).toBe(`收集反馈 ${theme}-${width}`);
      await page.reload();
      await expect(page.getByRole("button", { name: `收集反馈 ${theme}-${width}`, exact: true })).toBeVisible();

      await page.goto(`/studio/views/${f.people.view.id}`);
      await page.getByRole("button", { name: /林悦/ }).click();
      await page.getByRole("button", { name: "修改资料", exact: true }).click();
      const personDialog = page.getByRole("dialog", { name: "修改资料", exact: true });
      await personDialog.getByLabel("背景", { exact: true }).fill(`设计伙伴 · ${theme}-${width}`);
      await page.screenshot({ path: `/tmp/mindos-person-edit-${theme}-${width}.png` });
      let failPerson = true;
      await page.route("**/api/views", async route => {
        if (failPerson && route.request().method() === "POST" && route.request().postDataJSON()?.op === "person.update") {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "NETWORK_ERROR" }) });
        } else await route.continue();
      });
      await personDialog.getByRole("button", { name: "保存人物", exact: true }).click();
      await expect(personDialog.getByRole("alert")).toBeVisible();
      await expect(personDialog.getByLabel("背景", { exact: true })).toHaveValue(`设计伙伴 · ${theme}-${width}`);
      await page.screenshot({ path: `/tmp/mindos-person-error-${theme}-${width}.png` });
      failPerson = false;
      await personDialog.getByRole("button", { name: "保存人物", exact: true }).click();
      await expect(personDialog).toHaveCount(0);
      expect((await f.read(f.people.collection.id)).records[0].fields.background).toBe(`设计伙伴 · ${theme}-${width}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(pageErrors).toEqual([]);
    });
  }
}

test('explicit settings saves retain failed drafts and disable editing until completion', async ({ page, request, context, baseURL }) => {
  await pageFixture(request);
  await context.addCookies([{ name: 'locale', value: 'zh', url: baseURL! }]);
  await page.addInitScript(() => localStorage.setItem('locale', 'zh'));
  await page.goto('/settings?tab=knowledge');
  const input = page.getByLabel('自定义忽略路径', { exact: true });
  await input.fill('Build\nDrafts');
  const section = input.locator('xpath=ancestor::div[@aria-busy][1]');
  let fail = true, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/settings', async route => {
    if (route.request().method() === 'POST' && fail) {
      await gate;
      await route.fulfill({ status: 503, json: { error: 'Cannot save now' } });
    } else await route.continue();
  });
  await section.getByRole('button', { name: '保存', exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(section).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(section.getByRole('alert')).toContainText('Cannot save now');
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('Build\nDrafts');
  fail = false;
  await section.getByRole('button', { name: '保存', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('.mindosignore');
  await expect.poll(async () => (await (await request.get('/api/settings')).json()).searchIgnoredPaths).toEqual(['Build', 'Drafts']);
});
