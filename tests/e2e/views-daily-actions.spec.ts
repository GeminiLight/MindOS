import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assertViewsFixture } from "../helpers/views-fixture.mjs";
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Use pnpm test:views:isolated",
);
test.beforeEach(async ({ request }) => assertViewsFixture(request));
test.setTimeout(30_000);
test("completes and undoes tasks without a modal, recovers from failed writes and narrows due work", async ({
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
    folder: "Daily-" + randomUUID(),
    name: "日常推进",
    mode: "new",
    operationId: randomUUID(),
  });
  const read = async () =>
    (await request.get("/api/views/v2?op=read&viewId=" + c.view.id)).json();
  const data = await read();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  for (const input of [
    { title: "跟进设计反馈", status: "todo", dueDate: "2020-01-01" },
    { title: "今天整理材料", status: "todo", dueDate: today },
    { title: "已完成的旧任务", status: "done", dueDate: "2020-01-01" },
  ])
    await post("mutate", {
      collectionId: c.collection.id,
      action: "record.create",
      expectedSchemaRevision: data.schemaRevision,
      expectedRevision: (await read()).revision,
      operationId: randomUUID(),
      input,
    });
  await page.addInitScript(() => localStorage.setItem("locale", "zh"));
  await page
    .context()
    .addCookies([
      { name: "locale", value: "zh", url: process.env.MINDOS_URL! },
    ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(c.viewUrl);
  const due = page.getByRole("combobox", { name: "筛选到期时间" });
  await due.selectOption("overdue");
  await expect(
    page.getByRole("button", { name: "跟进设计反馈", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "已完成的旧任务", exact: true }),
  ).toHaveCount(0);
  let writes = 0;
  await page.route("**/api/views/v2", async (route) => {
    const r = route.request();
    if (r.method() === "POST" && r.postDataJSON()?.action === "record.update") {
      writes++;
      if (writes === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "临时无法保存，请重试" }),
        });
        return;
      }
    }
    await route.continue();
  });
  const complete = page.getByRole("checkbox", {
    name: "标记完成：跟进设计反馈",
  });
  await complete.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "临时无法保存" }),
  ).toBeVisible();
  expect(
    (await read()).records.find((r: any) => r.fields.title === "跟进设计反馈")
      .fields.status,
  ).toBe("todo");
  await complete.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "任务已完成。" }),
  ).toBeVisible();
  await expect(complete).toHaveCount(0);
  expect(
    (await read()).records.find((r: any) => r.fields.title === "跟进设计反馈")
      .fields.status,
  ).toBe("done");
  await page.getByRole("button", { name: "撤回上次编辑", exact: true }).click();
  await expect(complete).toBeVisible();
  expect(
    (await read()).records.find((r: any) => r.fields.title === "跟进设计反馈")
      .fields.status,
  ).toBe("todo");
  await due.selectOption("today");
  await expect(
    page.getByRole("button", { name: "今天整理材料", exact: true }),
  ).toBeVisible();
  await expect(complete).toHaveCount(0);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page
    .getByRole("checkbox", { name: "重新打开：已完成的旧任务" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "任务已重新打开。" }),
  ).toBeVisible();
  expect(
    (await read()).records.find((r: any) => r.fields.title === "已完成的旧任务")
      .fields.status,
  ).toBe("todo");
  await page.getByRole("button", { name: "撤回上次编辑", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "重新打开：已完成的旧任务" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await page
    .getByRole("group", { name: "页面布局" })
    .getByRole("button", { name: "看板", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "标记完成：跟进设计反馈" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.screenshot({
    path: "/tmp/mindos-daily-actions-narrow.png",
    animations: "disabled",
  });
});

test("focuses people with unfinished follow-ups and keeps search and narrow navigation usable", async ({
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
    folder: "Followups-" + randomUUID(),
    name: "待跟进的人",
    mode: "new",
    operationId: randomUUID(),
  });
  const read = async () =>
    (await request.get("/api/views/v2?op=read&viewId=" + c.view.id)).json();
  for (const [name, completed] of [
    ["林悦", false],
    ["周宁", true],
  ] as const) {
    let snapshot = await read();
    await post("mutate", {
      collectionId: c.collection.id,
      action: "record.create",
      expectedSchemaRevision: snapshot.schemaRevision,
      operationId: randomUUID(),
      input: { name, background: "设计伙伴" },
    });
    snapshot = await read();
    const person = snapshot.records.find((r: any) => r.fields.name === name);
    await post("mutate", {
      collectionId: c.collection.id,
      recordId: person.id,
      action: "followup.update",
      expectedSchemaRevision: snapshot.schemaRevision,
      expectedRevision: person.source.revision,
      operationId: randomUUID(),
      input: { text: "确认原型反馈", date: "2026-10-25", completed },
    });
  }
  await page.addInitScript(() => localStorage.setItem("locale", "zh"));
  await page
    .context()
    .addCookies([
      { name: "locale", value: "zh", url: process.env.MINDOS_URL! },
    ]);
  await page.goto(c.viewUrl);
  const filters = page.getByRole("group", { name: "筛选人物" });
  await filters.getByRole("button", { name: "待跟进", exact: true }).click();
  const list = page.getByRole("navigation", { name: "联系人", exact: true });
  await expect(list.getByRole("button", { name: /林悦/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /周宁/ })).toHaveCount(0);
  const search = page.getByRole("textbox", { name: "查找人物" });
  await search.fill("不存在");
  await expect(list.getByRole("button")).toHaveCount(0);
  await search.fill("原型");
  await expect(list.getByRole("button", { name: /林悦/ })).toBeVisible();
  await search.fill("");
  await filters.getByRole("button", { name: "全部人物", exact: true }).click();
  await expect(list.getByRole("button", { name: /周宁/ })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await filters.getByRole("button", { name: "待跟进", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.screenshot({
    path: "/tmp/mindos-people-followups-narrow.png",
    animations: "disabled",
  });
});
