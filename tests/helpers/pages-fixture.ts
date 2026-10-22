import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertViewsFixture } from "./views-fixture.mjs";
export async function pageFixture(request: APIRequestContext) {
  await assertViewsFixture(request);
  const { rootId } = await (await request.get("/api/views/v2")).json();
  const post = async (op: string, input: Record<string, unknown>) => {
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
      folder: name + "-" + randomUUID(),
      mode: "new",
      operationId: randomUUID(),
    });
  const tasks = await create("tasks", "产品推进"),
    people = await create("people", "伙伴");
  const read = async (collectionId: string) =>
    (
      await request.get("/api/views/v2?op=read&collectionId=" + collectionId)
    ).json();
  const add = async (c: any, input: Record<string, string>) => {
    const d = await read(c.collection.id);
    await post("mutate", {
      collectionId: c.collection.id,
      action: "record.create",
      operationId: randomUUID(),
      expectedRevision: d.revision,
      expectedSchemaRevision: d.schemaRevision,
      input,
    });
  };
  await add(people, { name: "林悦", background: "设计伙伴" });
  const person = (await read(people.collection.id)).records[0];
  await add(tasks, {
    title: "评审工作台原型",
    status: "todo",
    personRef: people.collection.id + "/" + person.id,
  });
  const folder = "讨论-" + randomUUID();
  mkdirSync(join(process.env.MINDOS_VIEWS_TEST_ROOT!, folder));
  writeFileSync(
    join(process.env.MINDOS_VIEWS_TEST_ROOT!, folder, "决策.md"),
    "# 原型讨论\n\n先完成双向联动，再精修页面。",
  );
  const spec = {
    specVersion: 1,
    title: "项目推进台",
    description: "一起推进下一步，保留每次讨论的上下文。",
    layout: { columns: 2, density: "comfortable" },
    blocks: [
      {
        id: "tasks",
        kind: "tasks",
        title: "下一步",
        collectionId: tasks.collection.id,
        fields: ["title", "status", "personRef"],
      },
      {
        id: "people",
        kind: "people",
        title: "一起协作的人",
        collectionId: people.collection.id,
      },
      { id: "notes", kind: "notes", title: "最近讨论", folder },
    ],
  };
  return { rootId, post, read, tasks, people, spec, folder };
}
export async function chinesePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("locale", "zh");
    localStorage.setItem("theme", "light");
  });
  await page
    .context()
    .addCookies([
      { name: "locale", value: "zh", url: process.env.MINDOS_URL! },
    ]);
}
