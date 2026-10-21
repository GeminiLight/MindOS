import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Requires an isolated knowledge library",
);
test.setTimeout(180000);
test("Agent creates tasks, human edits them, a second view and client see the same records", async ({
  page,
  request,
  browser,
}) => {
  const info = await (await request.get("/api/views/v2?op=describe")).json();
  const post = async (op: string, input: any) => {
    const r = await request.post("/api/views/v2", {
      data: { op, expectedRootId: info.rootId, ...input },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const c = await post("create", {
    name: "产品迭代",
    folder: "验证/项目-" + randomUUID(),
    template: "tasks",
    mode: "new",
    operationId: randomUUID(),
  });
  const read = async () =>
    (
      await request.get("/api/views/v2?op=read&collectionId=" + c.collection.id)
    ).json();
  let data = await read();
  await post("mutate", {
    collectionId: c.collection.id,
    action: "record.create",
    operationId: randomUUID(),
    expectedRevision: data.revision,
    expectedSchemaRevision: data.schemaRevision,
    input: { title: "完成产品提案", status: "todo", dueDate: "2026-10-24" },
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
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/studio/views/" + c.view.id);
  await expect(page.getByRole("heading", { name: "产品迭代" })).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page.getByRole("button", { name: "完成产品提案", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/mindos-generative-views-table.png" });
  await page.getByRole("button", { name: "完成产品提案", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("状态", { exact: true }).selectOption("doing");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read()).records[0].fields.status).toBe("doing");
  const preview = await post("preview", {
    collectionId: c.collection.id,
    spec: { ...c.view.spec, layout: "board", groupBy: "status" },
  });
  const board = await post("save", {
    draftId: preview.draftId,
    name: "项目看板",
    operationId: randomUUID(),
  });
  const second = await browser.newPage({ baseURL: process.env.MINDOS_URL });
  await second.goto("/studio/views/" + board.view.id);
  await expect(
    second.getByRole("button", { name: "完成产品提案" }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "完成产品提案", exact: true }).click();
  await dialog.getByLabel("状态", { exact: true }).selectOption("done");
  const started = Date.now();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    second
      .locator("section")
      .filter({ has: second.getByRole("heading", { name: /Done|已完成/ }) })
      .getByRole("button", { name: "完成产品提案" }),
  ).toBeVisible({ timeout: 5000 });
  console.log("cross-page update ms", Date.now() - started);
  await second.screenshot({ path: "/tmp/mindos-generative-views-board.png" });
  data = await read();
  await post("mutate", {
    collectionId: c.collection.id,
    action: "schema.extend",
    operationId: randomUUID(),
    expectedRevision: data.revision,
    expectedSchemaRevision: data.schemaRevision,
    input: { key: "x_context" },
  });
  expect((await read()).records[0].fields.x_context).toBe("");
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(async () => (await page.locator("h1").boundingBox())?.x ?? 999)
    .toBeLessThan(40);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(
    page.getByRole("button", { name: "复制给 Agent 的说明" }),
  ).toHaveCSS("color", "rgb(232, 228, 220)");
  await page.screenshot({
    path: "/tmp/mindos-generative-views-dark-narrow.png",
  });
  await second.close();
});
test("a generated people table edits the same Markdown read by the original people view", async ({
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
    name: "研究伙伴",
    folder: "验证/人物-" + randomUUID(),
    template: "people",
    mode: "new",
    operationId: randomUUID(),
  });
  const snapshot = await (
    await request.get("/api/views/v2?op=read&collectionId=" + c.collection.id)
  ).json();
  await post("mutate", {
    collectionId: c.collection.id,
    action: "record.create",
    operationId: randomUUID(),
    expectedSchemaRevision: snapshot.schemaRevision,
    input: { name: "叶遥", background: "独立研究者", focus: "工作流" },
  });
  for (const [action, input] of [
    ["interaction.add", { text: "确认参加访谈", date: "2026-10-22" }],
    ["followup.update", { text: "发送原型", date: "2026-10-24", completed: true }],
  ] as const) {
    const latest = await (await request.get("/api/views/v2?op=read&collectionId=" + c.collection.id)).json();
    await post("mutate", {
      collectionId: c.collection.id,
      recordId: latest.records[0].id,
      action,
      input,
      expectedRevision: latest.records[0].source.revision,
      expectedSchemaRevision: latest.schemaRevision,
      operationId: randomUUID(),
    });
  }
  const preview = await post("preview", {
    collectionId: c.collection.id,
    spec: {
      ...c.view.spec,
      layout: "table",
      fields: ["name", "background", "followup", "followupState", "lastInteraction"],
      sort: [{ field: "name", direction: "asc" }],
    },
  });
  const saved = await post("save", {
    draftId: preview.draftId,
    name: "按姓名浏览",
    operationId: randomUUID(),
  });
  await page.goto("/studio/views/" + saved.view.id);
  await expect(page.getByRole("button", { name: "叶遥" })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("cell", { name: /Done|已完成/, exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "确认参加访谈", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/mindos-generative-views-people.png" });
});

test("slow first reads settle, previews render, and external edits remain visible with 500 records", async ({
  page,
  request,
}) => {
  const { writeFileSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = process.env.MINDOS_VIEWS_TEST_ROOT;
  test.skip(!root, "Requires the explicit isolated fixture root");
  const info = await (await request.get("/api/views/v2?op=describe")).json();
  const post = async (op: string, input: any) => {
    const r = await request.post("/api/views/v2", {
      data: { op, expectedRootId: info.rootId, ...input },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const folder = "Scale-" + randomUUID();
  const c = await post("create", {
    name: "Scale check",
    folder,
    template: "tasks",
    mode: "new",
    operationId: randomUUID(),
  });
  const path = join(root!, folder, "TODO.csv");
  writeFileSync(
    path,
    "id,title,status,dueDate,personRef,sourcePath\n" +
      Array.from(
        { length: 500 },
        (_, i) => `t-${String(i).padStart(8, "0")},Scale task ${i},todo,,,`,
      ).join("\n") +
      "\n",
  );
  let slow = true;
  await page.route("**/api/views/v2?op=read&viewId=*", async (route) => {
    if (slow) {
      slow = false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await page.goto("/studio/views/" + c.view.id, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Scale task 499", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const snapshot = await (
    await request.get("/api/views/v2?op=read&collectionId=" + c.collection.id)
  ).json();
  const controlledAt = Date.now();
  await post("mutate", {
    collectionId: c.collection.id,
    recordId: "t-00000499",
    action: "record.update",
    operationId: randomUUID(),
    expectedRevision: snapshot.revision,
    expectedSchemaRevision: snapshot.schemaRevision,
    input: { title: "Controlled task 499" },
  });
  await expect(
    page.getByRole("button", { name: "Controlled task 499", exact: true }),
  ).toBeVisible({ timeout: 2000 });
  console.log(
    "500 record controlled visibility ms:",
    Date.now() - controlledAt,
  );
  await page.getByRole("button", { name: "Scale task 0", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(/Task|任务/, { exact: true })
    .fill("Unsaved local draft");
  const changed = Date.now();
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace("Scale task 0", "External task"),
  );
  await expect(
    page.getByRole("button", {
      name: "External task",
      exact: true,
      includeHidden: true,
    }),
  ).toBeVisible({ timeout: 5000 });
  console.log("500 record external visibility ms:", Date.now() - changed);
  await expect(dialog.getByLabel(/Task|任务/, { exact: true })).toHaveValue(
    "Unsaved local draft",
  );
  await dialog.getByRole("button", { name: /^Save$|^保存$/ }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(readFileSync(path, "utf8")).toContain("External task");
  await page.screenshot({ path: "/tmp/mindos-generative-views-conflict.png" });
  const d = await post("preview", {
    collectionId: c.collection.id,
    spec: {
      ...c.view.spec,
      fields: ["title"],
      filter: { all: [{ field: "title", op: "eq", value: "External task" }] },
    },
  });
  await page.goto(d.previewUrl, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: /View preview|视图预览/ }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("External task", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/mindos-generative-views-preview.png" });
  expect(snapshot.records).toHaveLength(500);
});
