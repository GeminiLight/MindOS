import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assertViewsFixture } from "../helpers/views-fixture.mjs";
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Use pnpm test:views:isolated",
);
test.beforeEach(async ({ request }) => assertViewsFixture(request));
test("one source has one workspace, layout switches do not create entries, and page presentation persists", async ({
  page,
  request,
}) => {
  const { rootId } = await (await request.get("/api/views/v2")).json();
  const post = async (op: string, input: any) => {
    const r = await request.post("/api/views/v2", {
      data: { op, expectedRootId: rootId, ...input },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const c = await post("create", {
    template: "tasks",
    folder: "Workspace-" + randomUUID(),
    name: "工作页面测试",
    mode: "new",
    operationId: randomUUID(),
  });
  const rebound = await post("create", {
    template: "tasks",
    folder: c.collection.folder,
    name: "不应重复",
    mode: "existing",
    operationId: randomUUID(),
  });
  expect(rebound.view.id).toBe(c.view.id);
  const preview = await post("preview", {
    collectionId: c.collection.id,
    spec: { ...c.view.spec, layout: "board", groupBy: "status" },
  });
  const alternative = await post("save", {
    draftId: preview.draftId,
    name: "按进展查看",
    operationId: randomUUID(),
  });
  await page.addInitScript(() => {
    localStorage.setItem("locale", "zh");
    localStorage.setItem("theme", "light");
  });
  await page
    .context()
    .addCookies([
      { name: "locale", value: "zh", url: process.env.MINDOS_URL! },
    ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio/views");
  const card = page.locator(`[data-view-workspace="${c.collection.id}"]`);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("2 种查看方式");
  const nav = page.locator('.sidebar-scroll-area nav[aria-label="视图"]');
  await expect(
    nav.getByRole("link", { name: "工作页面测试", exact: true }),
  ).toHaveCount(1);
  await expect(
    nav.getByRole("link", { name: "按进展查看", exact: true }),
  ).toHaveCount(0);
  await card.getByText("2 种查看方式").click();
  await card.getByRole("link", { name: /按进展查看/ }).click();
  await expect(
    page.getByRole("combobox", { name: "已保存的查看方式" }),
  ).toHaveValue(alternative.view.id);
  const layouts = page.getByRole("group", { name: "页面布局", exact: true });
  await layouts.getByRole("button", { name: "表格", exact: true }).click();
  await layouts.getByRole("button", { name: "卡片", exact: true }).click();
  await layouts.getByRole("button", { name: "看板", exact: true }).click();
  expect(
    (await (await request.get("/api/views/v2")).json()).views.filter(
      (v: any) => v.collectionId === c.collection.id,
    ),
  ).toHaveLength(2);
  await page.getByRole("button", { name: "调整视图", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("页面说明")
    .fill("把讨论转成行动，清楚地看到下一步。");
  await dialog.getByRole("button", { name: "预览", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "视图预览" })).toContainText(
    "把讨论转成行动",
  );
  await dialog.getByRole("button", { name: "保留此视图", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("把讨论转成行动，清楚地看到下一步。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "当前视图概览" }),
  ).toContainText("任务总数");
  const after = await (
    await request.get("/api/views/v2?op=read&viewId=" + alternative.view.id)
  ).json();
  expect(after.view.spec.page.description).toContain("把讨论转成行动");
});
test("people detail pages honor saved filters and restricted actions after layout switching", async ({
  page,
  request,
}) => {
  const { rootId } = await (await request.get("/api/views/v2")).json();
  const post = async (op: string, input: any) => {
    const r = await request.post("/api/views/v2", {
      data: { op, expectedRootId: rootId, ...input },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const c = await post("create", {
    template: "people",
    folder: "People-filter-" + randomUUID(),
    name: "筛选人脉",
    mode: "new",
    operationId: randomUUID(),
  });
  const snapshot = await (
    await request.get("/api/views/v2?op=read&collectionId=" + c.collection.id)
  ).json();
  for (const name of ["保留的联系人", "不在当前视图的人"])
    await post("mutate", {
      collectionId: c.collection.id,
      action: "record.create",
      expectedSchemaRevision: snapshot.schemaRevision,
      operationId: randomUUID(),
      input: { name, background: "未选择的背景信息" },
    });
  const spec = {
    ...c.view.spec,
    filter: { all: [{ field: "name", op: "eq", value: "保留的联系人" }] },
  };
  let draft = await post("preview", { collectionId: c.collection.id, spec });
  const view = await post("save", {
    draftId: draft.draftId,
    name: "当前关注",
    operationId: randomUUID(),
  });
  await page.addInitScript(() => localStorage.setItem("locale", "zh"));
  await page
    .context()
    .addCookies([
      { name: "locale", value: "zh", url: process.env.MINDOS_URL! },
    ]);
  await page.goto(view.viewUrl);
  const content = page.locator('[data-content-page-shell="studio"]');
  await expect(content).toContainText("保留的联系人");
  await expect(content).not.toContainText("不在当前视图的人");
  const current = await (await request.get("/api/views/v2?op=read&viewId=" + view.view.id)).json();
  await post("mutate", {
    collectionId: c.collection.id,
    action: "record.update",
    recordId: current.records[0].id,
    expectedRevision: current.records[0].source.revision,
    expectedSchemaRevision: current.schemaRevision,
    operationId: randomUUID(),
    input: { background: "Agent 刚更新的背景" },
  });
  await expect(content).toContainText("Agent 刚更新的背景");
  await page
    .getByRole("group", { name: "页面布局" })
    .getByRole("button", { name: "表格", exact: true })
    .click();
  await expect(
    content.getByRole("cell", { name: "保留的联系人", exact: true }),
  ).toBeVisible();
  await expect(content).not.toContainText("不在当前视图的人");
  draft = await post("preview", {
    collectionId: c.collection.id,
    spec: { ...spec, fields: ["name"] },
  });
  const minimal = await post("save", {
    draftId: draft.draftId,
    name: "只看姓名",
    operationId: randomUUID(),
  });
  await page.goto(minimal.viewUrl);
  await expect(content).toContainText("保留的联系人");
  await expect(content).not.toContainText("Agent 刚更新的背景");
  draft = await post("preview", {
    collectionId: c.collection.id,
    spec: { ...spec, actions: ["source.open"] },
  });
  const readonly = await post("save", {
    draftId: draft.draftId,
    name: "只读联系信息",
    operationId: randomUUID(),
  });
  await page.goto(readonly.viewUrl);
  await expect(
    content.getByRole("heading", { name: "只读联系信息", exact: true }),
  ).toBeVisible();
  await expect(
    content.getByRole("button", { name: "新建人物", exact: true }),
  ).toHaveCount(0);
  await expect(
    content.getByRole("button", { name: "保留的联系人", exact: true }),
  ).toHaveCount(0);
});
