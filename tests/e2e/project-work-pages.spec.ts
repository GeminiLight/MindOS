import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chinesePage, pageFixture } from "../helpers/pages-fixture";
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Use the disposable Views runner",
);

test("connects a real Studio project, people, task completion and original communication across browsers", async ({
  page,
  request,
  browser,
}) => {
  const f = await pageFixture(request);
  await chinesePage(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const title = "发布工作页 " + randomUUID().slice(0, 8);
  await page.goto("/studio/projects");
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "新建项目", exact: true });
  await dialog.getByLabel("项目名称", { exact: true }).fill(title);
  await dialog
    .getByLabel("目标", { exact: true })
    .fill("把原型、反馈和下一步放在同一处");
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/project-[a-f0-9-]+$/);
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
  const project = page.getByRole("region", { name: "项目工作页", exact: true });
  await project
    .getByRole("button", { name: "关联项目资料", exact: true })
    .click();
  await project
    .locator(`[data-project-task-source="${f.tasks.collection.id}"]`)
    .check();
  const person = (await f.read(f.people.collection.id)).records[0];
  const ref = f.people.collection.id + "/" + person.id;
  await project.locator(`[data-project-person-ref="${ref}"]`).check();
  await project
    .getByRole("button", { name: "保存项目关联", exact: true })
    .click();
  await expect(
    project.getByRole("button", { name: "打开工作页面", exact: true }),
  ).toBeVisible();
  await project
    .getByRole("button", { name: "打开工作页面", exact: true })
    .click();
  await expect(page).toHaveURL(/\/studio\/pages\/page-/);
  const url = page.url(),
    pageId = new URL(url).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "记录沟通", exact: true }).click();
  await page
    .getByLabel("沟通内容", { exact: true })
    .fill("原型评审通过；下一步由林悦补充反馈。");
  await page.getByRole("button", { name: "保存沟通", exact: true }).click();
  await expect(
    page.getByText("原型评审通过；下一步由林悦补充反馈。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "添加：" + f.tasks.view.name, exact: true })
    .click();
  const taskEditor = page.getByRole("dialog", {
    name: "新建任务",
    exact: true,
  });
  await taskEditor.getByPlaceholder("接下来要做什么？").fill("整理下一轮反馈");
  await taskEditor
    .getByRole("combobox", { name: "人物资料夹", exact: true })
    .selectOption(f.people.collection.id);
  await taskEditor
    .getByRole("combobox", { name: "选择人物", exact: true })
    .selectOption(ref);
  await taskEditor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "整理下一轮反馈", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-page-block]")
      .filter({
        has: page.getByRole("heading", {
          name: f.tasks.view.name,
          exact: true,
        }),
      })
      .getByRole("link", { name: "林悦", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: "标记完成：评审工作台原型", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await f.read(f.tasks.collection.id)).records[0].fields.status,
    )
    .toBe("done");
  await expect(
    page.getByRole("button", { name: "评审工作台原型", exact: true }),
  ).toHaveCount(0);
  const linked = page
    .getByRole("region", { name: "项目工作页", exact: true })
    .getByRole("link", { name: "林悦", exact: true });
  await linked.click();
  await expect(
    page.getByText("原型评审通过；下一步由林悦补充反馈。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看所属项目", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/studio/" + projectId + "$"));
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const other = await browser.newContext();
  try {
    const fresh = await other.newPage();
    await chinesePage(fresh);
    await fresh.goto("/studio/" + projectId);
    await expect(
      fresh.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await fresh
      .getByRole("button", { name: "打开工作页面", exact: true })
      .click();
    await expect(fresh).toHaveURL(url);
    await expect(
      fresh.getByText("原型评审通过；下一步由林悦补充反馈。", { exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
  const saved = await (
    await request.get("/api/views/v2?op=page.read&pageId=" + pageId)
  ).json();
  expect(saved.page.spec.projectId).toBe(projectId);
  const before = (
    await (await request.get("/api/views/v2?op=page.list")).json()
  ).pages.length;
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("原型评审通过；下一步由林悦补充反馈。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.sidebar-scroll-area nav[aria-label="视图"]'),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/mindos-project-work-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("原型评审通过；下一步由林悦补充反馈。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/mindos-project-work-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    (await (await request.get("/api/views/v2?op=page.list")).json()).pages
      .length,
  ).toBe(before);
});

test("keeps failed communication drafts across reload and retries one original-record operation", async ({
  page,
  request,
}) => {
  const f = await pageFixture(request),
    person = (await f.read(f.people.collection.id)).records[0],
    id = "project-" + randomUUID();
  await f.post("project.save", {
    project: {
      id,
      title: "恢复沟通草稿",
      goal: "保留未保存输入",
      taskCollectionIds: [f.tasks.collection.id],
      personRefs: [f.people.collection.id + "/" + person.id],
    },
    expectedVersion: 0,
    operationId: randomUUID(),
  });
  const { page: p } = await f.post("project.page", { projectId: id });
  await chinesePage(page);
  await page.goto("/studio/pages/" + p.id);
  const sent: string[] = [];
  let fail = true;
  await page.route("**/api/views/v2", async (route) => {
    const r = route.request();
    if (r.method() === "POST" && r.postDataJSON()?.op === "project.interact") {
      sent.push(r.postDataJSON().operationId);
      if (fail) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "暂时无法保存，请重试" }),
        });
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "记录沟通", exact: true }).click();
  await page
    .getByLabel("沟通内容", { exact: true })
    .fill("断线也要保留的项目决定");
  await page.getByRole("button", { name: "保存沟通", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "项目沟通", exact: true })
      .getByRole("alert"),
  ).toContainText("暂时无法保存");
  await page.reload();
  await expect(page.getByLabel("沟通内容", { exact: true })).toHaveValue(
    "断线也要保留的项目决定",
  );
  fail = false;
  await page.getByRole("button", { name: "保存沟通", exact: true }).click();
  await expect(
    page.getByText("断线也要保留的项目决定", { exact: true }),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[0]).toBe(sent[1]);
  const read = await (
    await request.get("/api/views/v2?op=project.read&projectId=" + id)
  ).json();
  expect(read.activity).toHaveLength(1);
});

test("uses real AI to refine one project region while preserving identity, people and source relationships", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.MINDOS_VIEWS_REAL_AI !== "1",
    "Requires explicit real-provider opt-in",
  );
  test.setTimeout(180000);
  const f = await pageFixture(request),
    person = (await f.read(f.people.collection.id)).records[0],
    id = "project-" + randomUUID();
  await f.post("project.save", {
    project: {
      id,
      title: "项目局部调整",
      goal: "只调整需要改变的区域",
      taskCollectionIds: [f.tasks.collection.id],
      personRefs: [f.people.collection.id + "/" + person.id],
    },
    expectedVersion: 0,
    operationId: randomUUID(),
  });
  const { page: p } = await f.post("project.page", { projectId: id });
  const block = p.spec.blocks.find((b: any) => b.kind === "tasks");
  await chinesePage(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/studio/pages/" + p.id);
  await page
    .getByRole("button", { name: "用 AI 调整：" + block.title, exact: true })
    .click();
  const prompt = page.getByLabel("描述页面调整", { exact: true });
  await expect(prompt).toBeFocused();
  await expect(
    page.getByRole("button", { name: "只展示未完成任务", exact: true }),
  ).toBeVisible();
  await prompt.fill(
    "只调整当前选中的任务区域：标题改为“本周推进”，layout 改为 table，保留原始 collectionId、筛选条件与字段。其他区域、项目身份和页面总体设置保持原样。",
  );
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.op === "page.generate",
    { timeout: 105000 },
  );
  await page.getByRole("button", { name: "生成预览", exact: true }).click();
  const r = await response,
    result = await r.json();
  expect(r.status(), JSON.stringify(result)).toBe(200);
  expect(result.spec.projectId).toBe(id);
  expect(result.spec.projectSources).toEqual(p.spec.projectSources);
  expect(result.spec.blocks.filter((b: any) => b.id !== block.id)).toEqual(
    p.spec.blocks.filter((b: any) => b.id !== block.id),
  );
  expect(result.spec.blocks.find((b: any) => b.id === block.id)).toMatchObject({
    title: "本周推进",
    layout: "table",
    collectionId: block.collectionId,
    filter: block.filter,
  });
  await expect(
    page.getByRole("region", { name: "调整预览", exact: true }),
  ).toContainText("布局");
  await expect(
    page.getByRole("button", { name: "记录沟通", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "应用调整", exact: true }).click();
  await page.getByRole("button", { name: "保存调整", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "本周推进", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "记录沟通", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/mindos-project-ai-region.png",
    fullPage: true,
    animations: "disabled",
  });
  const saved = await (
    await request.get("/api/views/v2?op=page.read&pageId=" + p.id)
  ).json();
  expect(saved.page.version).toBe(2);
  expect(saved.page.spec.projectId).toBe(id);
});
