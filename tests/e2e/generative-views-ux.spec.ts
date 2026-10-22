import { assertViewsFixture } from "../helpers/views-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Requires an isolated knowledge library",
);
test.setTimeout(120000);
test("people linking, draft recovery, filters and inline view preview form a complete human workflow", async ({
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
  const create = async (template: string) =>
    post("create", {
      template,
      name: template === "tasks" ? "体验打磨验收" : "验收联系人",
      folder: "体验验收/" + template + "-" + randomUUID(),
      mode: "new",
      operationId: randomUUID(),
    });
  const people = await create("people"),
    tasks = await create("tasks");
  const read = async (c: any) =>
    (
      await request.get("/api/views/v2?op=read&collectionId=" + c.collection.id)
    ).json();
  let snapshot = await read(people);
  await post("mutate", {
    collectionId: people.collection.id,
    action: "record.create",
    expectedSchemaRevision: snapshot.schemaRevision,
    operationId: randomUUID(),
    input: { name: "叶遥", background: "设计伙伴" },
  });
  snapshot = await read(tasks);
  await post("mutate", {
    collectionId: tasks.collection.id,
    action: "schema.extend",
    expectedRevision: snapshot.revision,
    expectedSchemaRevision: snapshot.schemaRevision,
    operationId: randomUUID(),
    input: { key: "x_notes" },
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(tasks.viewUrl);
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("任务", { exact: true }).fill("完成体验走查");
  await dialog.getByLabel("截止日期", { exact: true }).fill("2026-10-25");
  await dialog.getByLabel("人物资料夹").selectOption(people.collection.id);
  await dialog.getByLabel("选择人物").selectOption({ label: "叶遥" });
  await dialog.getByText("备注与来源", { exact: true }).click();
  await dialog.getByLabel("备注", { exact: true }).fill("保留输入，完成后同步");
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-ux-task-editor.png",
  });
  await page.route("**/api/views/v2", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().op === "mutate"
    )
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "暂时无法保存，请重试" }),
      });
    return route.continue();
  });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("暂时无法保存");
  await expect(dialog.getByLabel("任务", { exact: true })).toHaveValue(
    "完成体验走查",
  );
  await dialog.getByRole("button", { name: "保留草稿并关闭" }).click();
  await page.unroute("**/api/views/v2");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(dialog.getByLabel("任务", { exact: true })).toHaveValue(
    "完成体验走查",
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("已保存到本地，其他视图会同步更新。"),
  ).toBeVisible();
  snapshot = await read(tasks);
  expect(snapshot.records[0].fields).toMatchObject({
    title: "完成体验走查",
    dueDate: "2026-10-25",
    personRef: people.collection.id + "/" + (await read(people)).records[0].id,
    x_notes: "保留输入，完成后同步",
  });
  await page
    .getByRole("searchbox", { name: "搜索当前视图" })
    .fill("没有这个任务");
  await expect(page.getByText("暂无符合条件的记录")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page.getByRole("button", { name: "完成体验走查", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "完成体验走查", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "调整视图", exact: true }).click();
  await dialog.getByText("看板", { exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: "看板", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "预览", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "视图预览" })).toContainText(
    "完成体验走查",
  );
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-ux-inline-preview.png",
  });
  expect(
    (
      await (
        await request.get("/api/views/v2?op=read&viewId=" + tasks.view.id)
      ).json()
    ).view.spec.layout,
  ).toBe("table");
  await dialog.getByRole("button", { name: "保留此视图", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "待办 1", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-ux-board.png",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(
    page.getByRole("button", { name: "完成体验走查", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-ux-board-dark-narrow.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "调整视图", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: "看板", exact: true }),
  ).toBeChecked();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    animations: "disabled",
    path: "/tmp/mindos-ux-designer-dark-narrow.png",
  });
});

// Every mutating test verifies disposable ownership and server root before creating data.
test.beforeEach(async ({request}) => { await assertViewsFixture(request); });
