import { test, expect as playwrightExpect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
// This local-only suite also runs against cold, hot-reloading Next dev pages.
const expect = playwrightExpect.configure({ timeout: 30_000 });
// Explicit isolated root, separate from the user's library. No Agent is executed.
test.skip(
  !process.env.MINDOS_CONTEXT_TEST_ROOT,
  "Requires an isolated Context preview root",
);
test.setTimeout(180_000);
test.beforeAll(() => {
  const root = process.env.MINDOS_CONTEXT_TEST_ROOT!;
  expect(resolve(root)).toMatch(/^\/(?:private\/)?tmp\/mindos-context-[^/]+$/);
  const folder = join(root, '项目/MindOS');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, '项目简报.md'), '# 当前判断\n\nContext 是长期保留的工作资料。\n\n## 下一步\n\n- 核对当前证据\n- 记录结论\n');
  writeFileSync(join(folder, '访谈摘要.md'), '# 访谈摘要\n\n这份资料留在原处。\n');
  for (let i = 1; i <= 4; i++) {
    writeFileSync(join(folder, `备选材料 ${i}.md`), `# 备选材料 ${i}\n`);
  }
});
// The desktop preview also skips SW registration. Offline precaching is outside
// this flow and can trigger unrelated cold routes while Next dev is compiling.
test.use({ actionTimeout: 20_000, serviceWorkers: "block" });
test("continues actual Context, preserves positions and drafts, then hands off selected material", async ({
  page,
  request,
}) => {
  const root = process.env.MINDOS_CONTEXT_TEST_ROOT!;
  const progressText = `确认 Context 是持续工作的基础。下一步：核对文件与视图的对应关系。记录 ${randomUUID().slice(0, 8)}`;
  const folder = "项目/MindOS";
  const indexResponse = await request.get("/api/views", {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  expect(indexResponse.ok()).toBeTruthy();
  const index = await indexResponse.json();
  expect(index.rootId).toBe(
    createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24),
  );
  const material = await request.get("/api/context-work", {
    params: { rootId: index.rootId, folder },
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  expect(material.ok()).toBeTruthy();
  const errors: string[] = [];
  let executions = 0;
  await page.route("**/api/agent/sessions/*/turns", async (route) => {
    executions++;
    await route.abort();
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .context()
    .addCookies([
      { name: "locale", value: "zh", url: process.env.MINDOS_URL! },
    ]);
  await page.addInitScript(() => {
    localStorage.setItem("locale", "zh");
    localStorage.setItem("theme", "light");
    if (!localStorage.getItem("mindos:studio-projects"))
      localStorage.setItem(
        "mindos:studio-projects",
        JSON.stringify([
          {
            id: "context-proof",
            title: "MindOS 工作台",
            goal: "让资料、判断和下一步可以持续积累。",
            space: "项目/MindOS",
            spaces: [
              {
                path: "项目/MindOS",
                label: "MindOS",
                source: "project-default",
              },
            ],
            kits: [],
            workArea: "Mind",
            cadence: "",
            stage: "active",
            progress: 0,
            updated: "",
            nextAction: "核对项目简报中还需要确认的问题。",
            sessions: [],
            reviewItems: [],
            lessons: [],
          },
        ]),
      );
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    "/studio/context-proof?mode=files&file=" +
      encodeURIComponent(folder + "/项目简报.md"),
    { waitUntil: "domcontentloaded" },
  );
  const workspace = page.getByRole("region", {
    name: "项目 Context",
    exact: true,
  });
  // A cold Next dev compilation may exceed the API timeout; exercise its explicit retry.
  await expect(
    workspace
      .getByText("当前判断", { exact: true })
      .or(
        workspace
          .getByRole("button", { name: "重新读取", exact: true })
          .first(),
      ),
  ).toBeVisible({ timeout: 90_000 });
  if (
    await workspace
      .getByRole("button", { name: "重新读取", exact: true })
      .first()
      .isVisible()
  )
    await workspace
      .getByRole("button", { name: "重新读取", exact: true })
      .first()
      .click();
  await expect(workspace.getByText("当前判断", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-main-context-files.png",
  });
  await workspace.getByRole("button", { name: "视图", exact: true }).click();
  await expect(
    workspace.getByRole("heading", { name: "最近进展" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "记下进展", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("这次推进到了哪里").fill(progressText);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await workspace
    .getByRole("button", { name: "记下进展", exact: true })
    .click();
  await expect(dialog.getByLabel("这次推进到了哪里")).toHaveValue(
    /核对文件与视图/,
  );
  await dialog.getByRole("button", { name: "保存进展", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    workspace.getByRole("list").getByText(progressText, { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const collection = await (
    await request.get("/api/context-work", {
      params: { rootId: index.rootId, folder },
      headers: { "Sec-Fetch-Site": "same-origin" },
    })
  ).json();
  expect(
    readFileSync(join(root, collection.progress[0].path), "utf8"),
  ).toContain("下一步：核对文件与视图");
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-main-context-view.png",
  });
  await workspace.getByRole("button", { name: "文件", exact: true }).click();
  await expect(workspace.getByText("当前判断", { exact: true })).toBeVisible();
  await workspace
    .getByLabel("查找文件", { exact: true })
    .fill(progressText.slice(-8));
  await expect(
    workspace
      .getByRole("navigation", { name: "Context 文件" })
      .getByRole("button", { name: progressText }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "清除文件搜索" }).click();
  await workspace
    .getByRole("button", { name: "交给 Agent", exact: true })
    .click();
  dialog = page.getByRole("region", { name: "交给 Agent", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The primary action stays visible while the material list scrolls internally.
  await expect.poll(() => dialog.locator('footer').evaluate(el =>
    el.getBoundingClientRect().bottom <= window.innerHeight,
  )).toBe(true);
  await page.screenshot({path:'/tmp/mindos-context-inline-open.png', animations:'disabled'});
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => page.locator('#context-reading').evaluate(el =>
    el.getBoundingClientRect().width,
  )).toBeGreaterThan(280);
  await expect.poll(() => dialog.locator('footer').evaluate(el =>
    el.getBoundingClientRect().bottom <= window.innerHeight,
  )).toBe(true);
  await page.screenshot({path:'/tmp/mindos-context-inline-1280.png', animations:'disabled'});
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(workspace.getByText("当前判断", { exact: true })).toBeVisible();
  await expect(dialog.locator("input[type=checkbox]:checked")).toHaveCount(1);
  await dialog.getByRole('button', {name:'查看 访谈摘要.md',exact:true}).click();
  await expect(dialog.getByLabel('希望 Agent 帮你做什么')).toHaveValue('核对项目简报中还需要确认的问题。');
  await expect(dialog.locator('input[type=checkbox]:checked')).toHaveCount(1);
  await expect(dialog.getByRole('button', {name:'带上当前文件',exact:true})).toBeVisible();
  await workspace.getByRole('button', {name:'视图',exact:true}).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name:'查看 项目简报.md',exact:true}).click();
  await expect(workspace.getByText('当前判断', {exact:true})).toBeVisible();
  await dialog.getByRole("button", { name: "只看已选", exact: true }).click();
  await expect(dialog.locator("input[type=checkbox]")).toHaveCount(1);
  await dialog.getByRole("button", { name: "查看全部", exact: true }).click();
  await dialog.getByLabel("查找交接资料").fill("不存在的资料");
  await expect(
    dialog.getByText("没有符合条件的资料。", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("footer")).toContainText("已选 1 份资料");
  await dialog.getByRole("button", { name: "清除资料搜索" }).click();
  await dialog.getByRole("combobox", { name: "交给谁", exact: true }).click();
  await dialog.getByRole("option", { name: "Codex", exact: true }).click();
  await dialog
    .getByRole("button", { name: "查看完整内容", exact: true })
    .click();
  await expect(dialog.getByLabel("完整交接内容")).toHaveValue(
    /Context 是长期保留的工作资料/,
  );
  await expect(dialog.getByLabel("完整交接内容")).not.toHaveValue(/访谈摘要/);
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-main-context-handoff.png",
  });
  writeFileSync(
    join(root, folder, "项目简报.md"),
    readFileSync(join(root, folder, "项目简报.md"), "utf8") +
      "\n外部修改：新判断。\n",
  );
  await dialog
    .getByRole("button", { name: "复制给 Codex", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("资料已被修改");
  await dialog
    .getByRole("button", { name: "重新读取资料", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "查看完整内容", exact: true })
    .click();
  await expect(dialog.getByLabel("完整交接内容")).toHaveValue(
    /外部修改：新判断/,
  );
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("link", { name: "返回工作台", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "回到上次的位置", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-main-context-home.png",
  });
  await page
    .getByRole("button", { name: "回到上次的位置", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "文件", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(workspace.getByText("当前判断", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await workspace
    .getByRole("button", { name: "交给 Agent", exact: true })
    .click();
  await expect(dialog.getByLabel("希望 Agent 帮你做什么")).toHaveValue(
    "核对项目简报中还需要确认的问题。",
  );
  await page.route(
    (url) => url.pathname === "/api/changes" && url.searchParams.get("op") === "summary",
    (route) => route.fulfill({ json: { unreadCount: 99, totalCount: 99 } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("mindos:files-changed")));
  const activity = page.locator('[data-changes-banner-kind="activity"]');
  await expect(activity).toBeAttached();
  await expect(activity).toBeHidden({ timeout: 1500 });
  const mobileAction = dialog.getByRole("button", { name: "复制给 Codex", exact: true });
  await expect.poll(() => mobileAction.evaluate((button) => {
    const { x, y, width, height } = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(x + width / 2, y + height / 2));
  })).toBe(true);

  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-main-context-mobile-dark.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: "交给 Agent", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace
    .getByRole("button", { name: "交给 Agent", exact: true })
    .click();
  await dialog.getByRole("combobox", { name: "交给谁", exact: true }).click();
  await dialog.getByRole("option", { name: "MindOS", exact: true }).click();
  await dialog
    .getByRole("button", { name: "在 MindOS 中继续", exact: true })
    .click();
  const draft = page.getByRole("textbox", {
    name: "输入问题… @ 附加文件，/ 技能",
    exact: true,
  });
  await expect(draft).toHaveValue(/外部修改：新判断/);
  await expect(draft).not.toHaveValue(/访谈摘要/);
  await expect(draft).toBeFocused();
  await expect.poll(() => draft.evaluate((el: HTMLTextAreaElement) => ({
    top: el.scrollTop,
    caret: el.selectionStart,
  }))).toEqual({ top: 0, caret: 0 });
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-polish-agent-draft.png",
  });
  const origin = page.getByRole('region', { name: '本次 Context', exact:true });
  await expect(origin).toContainText('MindOS 工作台', {timeout: 30_000});
  await expect(origin).toContainText('本次交接清单 · 1 项资料');
  await origin.getByText('本次交接清单 · 1 项资料').click();
  await expect(origin.getByRole('button', {name:'查看 项目简报.md',exact:true})).toBeVisible();
  await page.screenshot({ path: '/tmp/mindos-context-connected-agent.png', animations:'disabled' });
  await origin.getByRole("button", { name: "回到资料", exact: true }).click();
  await expect(workspace.getByText("当前判断", { exact: true })).toBeVisible();
  expect(executions).toBe(0);
  expect(errors).toEqual([]);
});

test("links an existing folder from an empty project and resumes reading", async ({
  page,
  request,
}) => {
  const index = await (
    await request.get("/api/views", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    })
  ).json();
  expect(index.rootId).toBe(
    createHash("sha256")
      .update(resolve(process.env.MINDOS_CONTEXT_TEST_ROOT!))
      .digest("hex")
      .slice(0, 24),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .context()
    .addCookies([
      { name: "locale", value: "zh", url: process.env.MINDOS_URL! },
    ]);
  await page.addInitScript(() => {
    localStorage.setItem("locale", "zh");
    localStorage.setItem("theme", "light");
    if (!localStorage.getItem("mindos:studio-projects")) {
      localStorage.setItem("mindos:studio-projects", JSON.stringify([{
        id: "context-empty",
        title: "Context 体验",
        goal: "",
        space: "",
        spaces: [],
        kits: [],
        workArea: "Mind",
        cadence: "",
        stage: "active",
        progress: 0,
        updated: "",
        nextAction: "",
        sessions: [],
        reviewItems: [],
        lessons: [],
      }]));
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio/context-empty");
  const workspace = page.getByRole("region", {
    name: "项目 Context",
    exact: true,
  });
  await expect(
    workspace.getByRole("combobox", { name: "关联资料文件夹" }),
  ).toBeVisible({ timeout: 60_000 });
  await workspace.getByRole("combobox", { name: "关联资料文件夹" }).click();
  await workspace
    .getByRole("option", { name: "项目/MindOS", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "关联文件夹", exact: true })
    .click();
  await workspace.getByRole("button", { name: "文件", exact: true }).click();
  await workspace
    .getByRole("button", { name: "项目简报.md", exact: true })
    .click();
  await expect(workspace.getByText("当前判断", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回工作台", exact: true }).click();
  await page
    .getByRole("button", { name: "回到上次的位置", exact: true })
    .click();
  await expect(workspace.getByText("当前判断", { exact: true })).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-polish-first-project.png",
  });
  await page.goto("/studio/projects");
  await expect(
    page.getByRole("link", { name: /Context 体验/ }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
