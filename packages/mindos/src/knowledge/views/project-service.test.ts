import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkViewsService } from "./service.js";
import { WorkProjectsService } from "./project-service.js";
import { WorkPagesService } from "./page-service.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mindos-projects-"));
  roots.push(root);
  const work = new WorkViewsService(root, async (op) => {
    mkdirSync(dirname(join(root, op.path)), { recursive: true });
    writeFileSync(join(root, op.path), op.content!);
  });
  const tasks = await work.create({
    template: "tasks",
    folder: "Tasks",
    name: "Tasks",
    mode: "new",
    operationId: randomUUID(),
  });
  const people = await work.create({
    template: "people",
    folder: "People",
    name: "People",
    mode: "new",
    operationId: randomUUID(),
  });
  const add = async (collectionId: string, input: Record<string, string>) => {
    const s = work.read(collectionId);
    await work.mutate({
      collectionId,
      action: "record.create",
      input,
      expectedRevision: s.revision,
      expectedSchemaRevision: s.schemaRevision,
      operationId: randomUUID(),
    });
  };
  await add(people.collection.id, { name: "林悦 🪴" });
  await add(people.collection.id, { name: "未关联人物" });
  const person = work
    .read(people.collection.id)
    .records.find((r) => r.fields.name === "林悦 🪴")!;
  const ref = people.collection.id + "/" + person.id;
  await add(tasks.collection.id, { title: "确认原型", personRef: ref });
  const projects = new WorkProjectsService(root, work);
  const definition = {
    id: "launch",
    title: "产品发布",
    goal: "把事情做好",
    taskCollectionIds: [tasks.collection.id],
    personRefs: [ref],
  };
  const input = {
    expectedRootId: work.rootId,
    expectedVersion: 0,
    operationId: randomUUID(),
    project: definition,
  };
  return {
    root,
    work,
    tasks,
    people,
    person,
    ref,
    projects,
    definition,
    input,
  };
}
it("persists project identity and creates one reusable page scoped to linked people", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  const p = await f.projects.openPage({
    projectId: "launch",
    expectedRootId: f.work.rootId,
  });
  expect(
    (
      await f.projects.openPage({
        projectId: "launch",
        expectedRootId: f.work.rootId,
      })
    ).page.id,
  ).toBe(p.page.id);
  const read = new WorkPagesService(f.root).read(p.page.id);
  expect(read.page.spec.projectId).toBe("launch");
  expect(
    read.blocks.find((b) => b.data?.collection.template === "tasks")?.data?.spec
      .fields,
  ).toContain("personRef");
  expect(
    read.blocks
      .find((b) => b.data?.collection.template === "people")
      ?.data?.records.map((r) => r.id),
  ).toEqual([f.person.id]);
  expect(
    new WorkProjectsService(f.root, f.work).read("launch").project.title,
  ).toBe("产品发布");
  expect(new WorkPagesService(f.root).list().pages).toHaveLength(1);
});
it("writes project communication once to the original person and isolates other project timelines", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  await f.projects.save({
    ...f.input,
    operationId: randomUUID(),
    project: { ...f.definition, id: "other", taskCollectionIds: [] },
  });
  const snap = f.work.read(f.people.collection.id);
  const person = snap.records.find((r) => r.id === f.person.id)!;
  const input = {
    projectId: "launch",
    personRef: f.ref,
    text: "评审通过，周五确认 🚀",
    date: "2026-10-23",
    expectedRootId: f.work.rootId,
    expectedVersion: 1,
    expectedRevision: person.source.revision,
    expectedSchemaRevision: snap.schemaRevision,
    operationId: randomUUID(),
  };
  await f.projects.interact(input);
  await f.projects.interact(input);
  expect(f.projects.read("launch").activity).toHaveLength(1);
  expect(f.projects.read("other").activity).toHaveLength(0);
  const raw = readFileSync(join(f.root, person.source.path), "utf8");
  expect(raw).toContain("mindos-project:launch");
  expect(raw).toContain("评审通过");
});
it("rejects wrong roots, stale settings, duplicate ownership and nonmember communication without modifying data", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  await f.projects.save(f.input);
  await expect(
    f.projects.save({ ...f.input, operationId: randomUUID() }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await expect(
    f.projects.save({ ...f.input, expectedRootId: "wrong" }),
  ).rejects.toMatchObject({ code: "ROOT_CHANGED" });
  await expect(
    f.projects.save({
      ...f.input,
      operationId: randomUUID(),
      project: { ...f.definition, id: "other" },
    }),
  ).rejects.toMatchObject({ code: "PROJECT_COLLECTION_OWNED" });
  await expect(
    f.projects.interact({
      expectedRootId: f.work.rootId,
      projectId: "launch",
      personRef: "wrong",
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "PROJECT_PERSON_MISSING" });
  expect(f.projects.list().projects).toHaveLength(1);
});
it("allows empty projects and explicit unlinking while preserving original records", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  await f.projects.save({
    ...f.input,
    operationId: randomUUID(),
    expectedVersion: 1,
    project: { ...f.definition, taskCollectionIds: [], personRefs: [] },
  });
  expect(f.projects.read("launch").activity).toEqual([]);
  expect(f.work.read(f.tasks.collection.id).records).toHaveLength(1);
  const page = await f.projects.openPage({
    projectId: "launch",
    expectedRootId: f.work.rootId,
  });
  expect(page.page.spec.blocks.length).toBeGreaterThan(0);
});
it("updates source relationships without replacing a customized layout or duplicating the page", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  const opened = await f.projects.openPage({
    projectId: "launch",
    expectedRootId: f.work.rootId,
  });
  const pages = new WorkPagesService(f.root);
  await pages.save({
    pageId: opened.page.id,
    expectedVersion: opened.page.version,
    expectedRootId: f.work.rootId,
    operationId: randomUUID(),
    spec: {
      ...opened.page.spec,
      title: "我的日常",
      layout: { columns: 1, density: "compact" },
    },
  });
  const second = await f.work.create({
    template: "tasks",
    folder: "OtherTasks",
    name: "OtherTasks",
    mode: "new",
    operationId: randomUUID(),
  });
  await f.projects.save({
    ...f.input,
    operationId: randomUUID(),
    expectedVersion: 1,
    project: { ...f.definition, taskCollectionIds: [second.collection.id] },
  });
  const updated = await f.projects.openPage({
    projectId: "launch",
    expectedRootId: f.work.rootId,
  });
  expect(updated.page.id).toBe(opened.page.id);
  expect(updated.page.spec.title).toBe("我的日常");
  expect(updated.page.spec.layout).toEqual({ columns: 1, density: "compact" });
  expect(
    updated.page.spec.blocks.some(
      (b) => b.collectionId === f.tasks.collection.id,
    ),
  ).toBe(false);
  expect(
    updated.page.spec.blocks.some(
      (b) => b.collectionId === second.collection.id,
    ),
  ).toBe(true);
});
it("refuses corrupt metadata and symlinks rather than replacing existing data", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  const path = join(f.root, ".mindos/views/projects.json");
  writeFileSync(path, "broken");
  expect(() => f.projects.list()).toThrow();
  expect(readFileSync(path, "utf8")).toBe("broken");
  rmSync(path);
  const outside = join(f.root, "original.json");
  writeFileSync(outside, "{}");
  symlinkSync(outside, path);
  await expect(f.projects.save(f.input)).rejects.toMatchObject({
    code: "ACCESS_DENIED",
  });
  expect(readFileSync(outside, "utf8")).toBe("{}");
});
it("recreates one default page after explicit removal without resurrecting its retired identity", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  const p = await f.projects.openPage({
    projectId: "launch",
    expectedRootId: f.work.rootId,
  });
  await new WorkPagesService(f.root).remove({
    pageId: p.page.id,
    expectedRootId: f.work.rootId,
    expectedVersion: p.page.version,
    operationId: randomUUID(),
  });
  const next = await f.projects.openPage({
    projectId: "launch",
    expectedRootId: f.work.rootId,
  });
  expect(next.page.id).not.toBe(p.page.id);
  expect(
    (
      await f.projects.openPage({
        projectId: "launch",
        expectedRootId: f.work.rootId,
      })
    ).page.id,
  ).toBe(next.page.id);
  expect(f.projects.read("launch").pageId).toBe(next.page.id);
});
it("serializes simultaneous claims on one task collection and rejects changed operation replays", async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled([
    f.projects.save(f.input),
    f.projects.save({
      ...f.input,
      operationId: randomUUID(),
      project: { ...f.definition, id: "second" },
    }),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.projects.list().projects).toHaveLength(1);
  const saved = f.projects.list().projects[0]!;
  const next = {
    ...f.input,
    operationId: randomUUID(),
    expectedVersion: saved.version,
    project: { ...f.definition, id: saved.id, title: "新的目标" },
  };
  await f.projects.save(next);
  await expect(
    f.projects.save({
      ...next,
      project: { ...next.project, title: "不同的重试" },
    }),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
});
it("rejects duplicate and oversized relationships, invalid communication dates and cancelled writes", async () => {
  const f = await fixture();
  await expect(
    f.projects.save({
      ...f.input,
      project: { ...f.definition, personRefs: [f.ref, f.ref] },
    }),
  ).rejects.toMatchObject({ code: "INVALID_PROJECT" });
  await expect(
    f.projects.save({
      ...f.input,
      project: { ...f.definition, title: "界".repeat(101) },
    }),
  ).rejects.toMatchObject({ code: "INVALID_PROJECT" });
  await f.projects.save(f.input);
  const p = f.work
    .read(f.people.collection.id)
    .records.find((r) => r.id === f.person.id)!;
  await expect(
    f.projects.interact({
      projectId: "launch",
      personRef: f.ref,
      text: "无效日期",
      date: "2026-02-30",
      expectedRootId: f.work.rootId,
      expectedVersion: 1,
      expectedRevision: p.source.revision,
      expectedSchemaRevision: p.schemaRevision,
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(f.projects.read("launch").activity).toEqual([]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    new WorkProjectsService(f.root, f.work, controller.signal).save({
      ...f.input,
      operationId: randomUUID(),
      expectedVersion: 1,
    }),
  ).rejects.toThrow();
  expect(f.projects.read("launch").project.version).toBe(1);
});
it("keeps project identity through page saves and refuses sources outside current relationships", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  const p = await f.projects.openPage({
      projectId: "launch",
      expectedRootId: f.work.rootId,
    }),
    pages = new WorkPagesService(f.root);
  await expect(
    pages.save({
      pageId: p.page.id,
      expectedVersion: 1,
      expectedRootId: f.work.rootId,
      operationId: randomUUID(),
      spec: { ...p.page.spec, projectId: undefined },
    }),
  ).rejects.toMatchObject({ code: "PROJECT_BINDING_CHANGED" });
  const other = await f.work.create({
    template: "tasks",
    name: "Other",
    folder: "Other",
    mode: "new",
    operationId: randomUUID(),
  });
  const data = pages.preview({
    expectedRootId: f.work.rootId,
    spec: {
      ...p.page.spec,
      blocks: [
        {
          id: "outside",
          kind: "html",
          title: "Other",
          collectionId: other.collection.id,
          html: "<p>Other</p>",
        },
      ],
    },
  });
  expect(data.blocks[0].error?.code).toBe("PROJECT_SOURCE_UNLINKED");
});
it("opens a project page with a long Unicode goal without losing the complete project definition", async () => {
  const f = await fixture(),
    goal = "🪴 项目目标 ".repeat(200);
  await f.projects.save({ ...f.input, project: { ...f.definition, goal } });
  const p = await f.projects.openPage({
    projectId: "launch",
    expectedRootId: f.work.rootId,
  });
  expect(p.page.spec.description!.length).toBeLessThanOrEqual(500);
  expect(f.projects.read("launch").project.goal).toBe(goal.trim());
});
it("rejects stale project actions even when the original task revision is still current", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  const s = f.work.read(f.tasks.collection.id),
    record = s.records[0]!;
  const action = {
    projectId: "launch",
    expectedProjectVersion: 1,
    expectedRootId: f.work.rootId,
    collectionId: f.tasks.collection.id,
    recordId: record.id,
    action: "record.update",
    expectedRevision: record.source.revision,
    expectedSchemaRevision: s.schemaRevision,
    operationId: randomUUID(),
    input: { status: "done" },
  };
  await f.projects.save({
    ...f.input,
    expectedVersion: 1,
    operationId: randomUUID(),
    project: { ...f.definition, taskCollectionIds: [] },
  });
  await expect(f.work.mutate(action)).rejects.toMatchObject({
    code: "PROJECT_CHANGED",
  });
  expect(f.work.read(f.tasks.collection.id).records[0].fields.status).toBe(
    "todo",
  );
});
it("restores presentation while retaining the current project identity even from an older unbound layout", async () => {
  const f = await fixture();
  await f.projects.save(f.input);
  const current = await f.projects.openPage({
      projectId: "launch",
      expectedRootId: f.work.rootId,
    }),
    pages = new WorkPagesService(f.root);
  const initial = await pages.save({
    spec: {
      ...current.page.spec,
      projectId: undefined,
      projectSources: undefined,
    },
    expectedRootId: f.work.rootId,
    expectedVersion: 0,
    operationId: randomUUID(),
  });
  await pages.save({
    pageId: initial.page.id,
    spec: { ...current.page.spec, title: "现在的布局" },
    expectedRootId: f.work.rootId,
    expectedVersion: 1,
    operationId: randomUUID(),
  });
  const restored = await pages.restore({
    pageId: initial.page.id,
    restoreVersion: 1,
    expectedRootId: f.work.rootId,
    expectedVersion: 2,
    operationId: randomUUID(),
  });
  expect(restored.page.spec.projectId).toBe("launch");
  expect(restored.page.spec.projectSources).toEqual(
    current.page.spec.projectSources,
  );
});
