import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assertViewsFixture } from "../helpers/views-fixture.mjs";
test.skip(
  process.env.MINDOS_VIEWS_ISOLATED !== "1",
  "Use isolated Views runner",
);
test.beforeEach(async ({ request }) => assertViewsFixture(request));
test("connects a person and multiple project task pages without copying records", async ({
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
  const create = (template: string, name: string) =>
    post("create", {
      template,
      name,
      folder: name + randomUUID(),
      mode: "new",
      operationId: randomUUID(),
    });
  const people = await create("people", "合作伙伴"),
    a = await create("tasks", "产品迭代"),
    b = await create("tasks", "内容计划");
  const read = async (c: any) =>
    (
      await request.get("/api/views/v2?op=read&collectionId=" + c.collection.id)
    ).json();
  const add = async (c: any, input: any) => {
    const d = await read(c);
    return post("mutate", {
      collectionId: c.collection.id,
      action: "record.create",
      input,
      expectedRevision: d.revision,
      expectedSchemaRevision: d.schemaRevision,
      operationId: randomUUID(),
    });
  };
  await add(people, { name: "林悦", background: "设计伙伴" });
  const person = (await read(people)).records[0],
    personRef = people.collection.id + "/" + person.id;
  await add(a, { title: "评审原型", status: "todo", personRef });
  await add(b, { title: "整理案例", status: "done", personRef });
  const preview = await post("preview", {
    collectionId: a.collection.id,
    spec: { ...a.view.spec, fields: ["title", "status", "personRef"] },
  });
  await post("save", {
    draftId: preview.draftId,
    viewId: a.view.id,
    expectedViewVersion: a.view.version,
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
  // Simulate a healthy connection that silently loses messages. Business reads/writes remain real.
  await page.addInitScript(() => {
    class SilentEvents extends EventTarget {
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(_url: string) {
        super();
        queueMicrotask(() => {
          this.onopen?.(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("ready", {
              data: JSON.stringify({
                type: "ready",
                lastEventId: 0,
                resync: false,
              }),
              lastEventId: "0",
            }),
          );
        });
      }
      close() {}
    }
    window.EventSource = SilentEvents as unknown as typeof EventSource;
  });
  await page.goto(people.viewUrl + "?person=" + person.id);
  const panel = page.getByRole("region", { name: "相关项目待办" });
  await expect(
    panel.getByRole("button", { name: "评审原型", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "整理案例", exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: /查看已完成/ }).click();
  await expect(
    panel.getByRole("button", { name: "整理案例", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "评审原型", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("任务", { exact: true }).fill("评审原型并确认下一步");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "评审原型并确认下一步", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "选择项目待办" })
    .selectOption(b.view.id);
  await panel.getByRole("button", { name: "添加关联任务" }).click();
  await expect(dialog.getByRole("combobox", { name: "选择人物" })).toHaveValue(
    personRef,
  );
  await dialog.getByLabel("任务", { exact: true }).fill("一起梳理下一篇案例");
  const livePerson = (await read(people)).records[0];
  await post("mutate", {
    collectionId: people.collection.id,
    recordId: person.id,
    action: "record.update",
    operationId: randomUUID(),
    expectedRevision: livePerson.source.revision,
    expectedSchemaRevision: livePerson.schemaRevision,
    input: { background: "外部更新的设计伙伴" },
  });
  await expect(
    page.getByText("外部更新的设计伙伴", { exact: true }).last(),
  ).toBeVisible();
  await expect(dialog.getByLabel("任务", { exact: true })).toHaveValue(
    "一起梳理下一篇案例",
  );

  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "一起梳理下一篇案例", exact: true }),
  ).toBeVisible();
  expect(
    (await read(b)).records.find(
      (r: any) => r.fields.title === "一起梳理下一篇案例",
    ).fields.personRef,
  ).toBe(personRef);
  const updatedProject = await read(b);
  const linkedTask = updatedProject.records.find(
    (r: any) => r.fields.title === "一起梳理下一篇案例",
  );
  await post("mutate", {
    collectionId: b.collection.id,
    recordId: linkedTask.id,
    action: "record.update",
    operationId: randomUUID(),
    expectedRevision: updatedProject.revision,
    expectedSchemaRevision: updatedProject.schemaRevision,
    input: { title: "一起梳理下一篇案例与素材" },
  });
  await expect(
    panel.getByRole("button", {
      name: "一起梳理下一篇案例与素材",
      exact: true,
    }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/mindos-person-project-links-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.screenshot({
    path: "/tmp/mindos-person-project-links-narrow.png",
    animations: "disabled",
  });
  await page.goto(a.viewUrl);
  await page.getByRole("link", { name: "林悦", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "林悦", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "评审原型并确认下一步", exact: true }),
  ).toBeVisible();
  let fail = true;
  await page.route("**/api/views/v2?**", (route) => {
    if (
      fail &&
      new URL(route.request().url()).searchParams.get("op") === "related"
    )
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "unavailable" }),
      });
    return route.continue();
  });
  await page.reload();
  await expect(panel.getByRole("alert")).toContainText("关联任务暂时无法读取");
  fail = false;
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "评审原型并确认下一步", exact: true }),
  ).toBeVisible();
});
