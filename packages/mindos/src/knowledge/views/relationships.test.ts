import { serializeTasks, TASK_HEADERS } from "./tasks-csv.js";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkViewsService } from "./service.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "views-relations-"));
  roots.push(root);
  const s = new WorkViewsService(root, async (o) => {
    mkdirSync(dirname(join(root, o.path)), { recursive: true });
    writeFileSync(join(root, o.path), o.content!);
  });
  const create = (template: string, folder: string) =>
    s.create({
      template,
      folder,
      name: folder,
      mode: "new",
      operationId: randomUUID(),
    });
  const people = await create("people", "People");
  for (const name of ["林悦", "林悦"])
    await s.mutate({
      collectionId: people.collection.id,
      action: "record.create",
      expectedSchemaRevision: s.read(people.collection.id).schemaRevision,
      operationId: randomUUID(),
      input: { name },
    });
  const [person, other] = s.read(people.collection.id).records;
  const task = async (c: any, title: string, personId = person.id) => {
    const d = s.read(c.collection.id);
    await s.mutate({
      collectionId: c.collection.id,
      action: "record.create",
      operationId: randomUUID(),
      expectedRevision: d.revision,
      expectedSchemaRevision: d.schemaRevision,
      input: {
        title,
        status: "todo",
        personRef: people.collection.id + "/" + personId,
      },
    });
  };
  return { root, s, create, people, person, other, task };
}
it("links by stable identity across projects and resolves names without changing task fields", async () => {
  const { s, create, people, person, other, task } = await fixture();
  const a = await create("tasks", "Project A"),
    b = await create("tasks", "Project B");
  await task(a, "原型");
  await task(a, "同名其他人", other.id);
  await task(b, "复盘");
  const r = s.related(people.collection.id, person.id);
  expect(r.groups.map((g) => g.records.map((t) => t.fields.title))).toEqual([
    ["原型"],
    ["复盘"],
  ]);
  expect(s.read(a.collection.id).records[0]).toMatchObject({
    personName: "林悦",
    personHref: expect.stringContaining("?person="),
  });
  expect(r.incomplete).toBe(false);
});
it("honors saved projections and reports partial failure instead of an empty success", async () => {
  const { root, s, create, people, person, task } = await fixture();
  const a = await create("tasks", "A"),
    b = await create("tasks", "B");
  await task(a, "隐藏状态");
  await task(b, "损坏");
  const preview = await s.preview({
    collectionId: a.collection.id,
    spec: { ...a.view.spec, fields: ["title", "personRef"], actions: [] },
  });
  await s.save({
    draftId: preview.draftId,
    viewId: a.view.id,
    expectedViewVersion: a.view.version,
    operationId: randomUUID(),
  });
  writeFileSync(join(root, "B/TODO.csv"), "broken");
  const r = s.related(people.collection.id, person.id);
  expect(r.incomplete).toBe(true);
  expect(r.groups).toHaveLength(1);
  expect(r.groups[0].records[0].fields.status).toBeUndefined();
  expect(r.groups[0].canCreate).toBe(false);
});
it("rejects missing people, handles empty projects and bounds scanning", async () => {
  const { s, create, people, person } = await fixture();
  expect(s.related(people.collection.id, person.id).groups).toEqual([]);
  expect(() => s.related(people.collection.id, "p-missing123")).toThrow();
  for (let i = 0; i < 31; i++) await create("tasks", "Project" + i);
  const r = s.related(people.collection.id, person.id);
  expect(r.groups).toHaveLength(30);
  expect(r.incomplete).toBe(true);
});

it("does not duplicate alternate views and respects saved filters and hidden titles", async () => {
  const { s, create, people, person, task } = await fixture();
  const a = await create("tasks", "A");
  await task(a, "Visible");
  const preview = await s.preview({
    collectionId: a.collection.id,
    spec: a.view.spec,
  });
  await s.save({
    draftId: preview.draftId,
    name: "Alternative",
    operationId: randomUUID(),
  });
  expect(s.related(people.collection.id, person.id).groups).toHaveLength(1);
  const filtered = await s.preview({
    collectionId: a.collection.id,
    spec: {
      ...a.view.spec,
      filter: { all: [{ field: "status", op: "eq", value: "done" }] },
    },
  });
  await s.save({
    draftId: filtered.draftId,
    viewId: a.view.id,
    expectedViewVersion: 1,
    operationId: randomUUID(),
  });
  expect(s.related(people.collection.id, person.id).groups[0].records).toEqual(
    [],
  );
  const hidden = await s.preview({
    collectionId: a.collection.id,
    spec: { ...a.view.spec, fields: ["status"] },
  });
  await s.save({
    draftId: hidden.draftId,
    viewId: a.view.id,
    expectedViewVersion: 2,
    operationId: randomUUID(),
  });
  expect(s.related(people.collection.id, person.id).groups).toEqual([]);
});
it("refreshes person names from source and leaves a missing reference intact without a dead link", async () => {
  const { root, s, create, people, person, task } = await fixture();
  const a = await create("tasks", "A");
  await task(a, "Task");
  await s.mutate({
    collectionId: people.collection.id,
    recordId: person.id,
    action: "record.update",
    operationId: randomUUID(),
    expectedRevision: person.source.revision,
    expectedSchemaRevision: person.schemaRevision,
    input: { name: "新姓名" },
  });
  expect(s.read(a.collection.id).records[0].personName).toBe("新姓名");
  rmSync(join(root, person.source.path));
  const record = s.read(a.collection.id).records[0];
  expect(record.personName).toBeUndefined();
  expect(record.personHref).toBeUndefined();
  expect(record.fields.personRef).toBe(people.collection.id + "/" + person.id);
});

it("bounds the response and marks truncated relationships incomplete", async () => {
  const { root, s, create, people, person } = await fixture();
  await create("tasks", "Many");
  writeFileSync(
    join(root, "Many/TODO.csv"),
    serializeTasks({
      headers: TASK_HEADERS,
      rows: Array.from({ length: 101 }, (_, i) => ({
        id: "t-" + randomUUID(),
        title: "Task " + i,
        status: "todo",
        dueDate: "",
        personRef: people.collection.id + "/" + person.id,
        sourcePath: "",
      })),
    }),
  );
  const result = s.related(people.collection.id, person.id);
  expect(result.groups[0].records).toHaveLength(100);
  expect(result.incomplete).toBe(true);
});
