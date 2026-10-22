import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkViewsService } from "./service.js";
import { WorkPagesService } from "./page-service.js";
import { validatePageSpec } from "./page-spec.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mindos-pages-"));
  roots.push(root);
  const work = new WorkViewsService(root, async (op) => {
    mkdirSync(dirname(join(root, op.path)), { recursive: true });
    writeFileSync(join(root, op.path), op.content!);
  });
  const tasks = await work.create({
    template: "tasks",
    folder: "Project",
    name: "Project",
    mode: "new",
    operationId: randomUUID(),
  });
  const snap = work.read(tasks.collection.id);
  await work.mutate({
    collectionId: tasks.collection.id,
    action: "record.create",
    operationId: randomUUID(),
    expectedRevision: snap.revision,
    expectedSchemaRevision: snap.schemaRevision,
    input: { title: "真实任务", status: "todo" },
  });
  const pages = new WorkPagesService(root, work);
  const spec = {
    specVersion: 1,
    title: "我的推进页",
    layout: { columns: 2, density: "comfortable" },
    blocks: [
      {
        id: "tasks",
        title: "下一步",
        kind: "tasks",
        collectionId: tasks.collection.id,
      },
    ],
  } as const;
  return { root, work, tasks, pages, spec };
}
it("previews actual records without adding navigation, then saves and restores layout without rewriting tasks", async () => {
  const { root, pages, spec } = await fixture();
  const original = readFileSync(join(root, "Project/TODO.csv"), "utf8");
  const preview = pages.preview({ spec, expectedRootId: pages.rootId });
  expect(preview.blocks[0].data?.records[0].fields.title).toBe("真实任务");
  expect(pages.list().pages).toHaveLength(0);
  const saved = await pages.save({
    spec,
    expectedVersion: 0,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  });
  expect(saved.page.version).toBe(1);
  expect(pages.list().pages).toHaveLength(1);
  const next = await pages.save({
    pageId: saved.page.id,
    spec: { ...spec, title: "新布局" },
    expectedVersion: 1,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  });
  expect(next.page.history.map((v) => v.version)).toEqual([1]);
  const restored = await pages.restore({
    pageId: saved.page.id,
    restoreVersion: 1,
    expectedVersion: 2,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  });
  expect(restored.page.spec.title).toBe(spec.title);
  expect(restored.page.version).toBe(3);
  expect(readFileSync(join(root, "Project/TODO.csv"), "utf8")).toBe(original);
});
it("keeps retries idempotent and rejects wrong roots, stale versions and reused operation IDs", async () => {
  const { pages, spec } = await fixture();
  const input = {
    spec,
    expectedVersion: 0,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  };
  const [a, b] = await Promise.all([pages.save(input), pages.save(input)]);
  expect(a.page.id).toBe(b.page.id);
  expect(pages.list().pages).toHaveLength(1);
  await expect(
    pages.save({ ...input, spec: { ...spec, title: "different" } }),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  await expect(
    pages.save({
      ...input,
      expectedRootId: "wrong",
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "ROOT_CHANGED" });
  await expect(
    pages.save({
      ...input,
      pageId: a.page.id,
      expectedVersion: 0,
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  const remove = {
    pageId: a.page.id,
    expectedVersion: 1,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  };
  await pages.remove(remove);
  await pages.remove(remove);
  expect(pages.list().pages).toHaveLength(0);
  await expect(pages.save(input)).rejects.toMatchObject({
    code: "PAGE_MISSING",
  });
});
it("combines collections and bounded notes while reporting missing sources independently", async () => {
  const { root, pages, spec } = await fixture();
  mkdirSync(join(root, "Notes"));
  writeFileSync(join(root, "Notes", "one.md"), "# 决策\n\n保持本地优先");
  const data = pages.preview({
    expectedRootId: pages.rootId,
    spec: {
      ...spec,
      blocks: [
        ...spec.blocks,
        { id: "notes", title: "笔记", kind: "notes", folder: "Notes" },
        {
          id: "missing",
          title: "Missing",
          kind: "tasks",
          collectionId: "c-missing123",
        },
      ],
    },
  });
  expect(data.blocks[0].data?.records).toHaveLength(1);
  expect(data.blocks[1].notes?.[0]).toMatchObject({
    title: "决策",
    content: "# 决策\n\n保持本地优先",
  });
  expect(data.blocks[2].error?.code).toBe("COLLECTION_MISSING");
  for (let i = 0; i < 11; i++)
    writeFileSync(join(root, "Notes", `extra-${i}.md`), "note");
  const limited = pages.preview({
    expectedRootId: pages.rootId,
    spec: {
      ...spec,
      blocks: [{ id: "notes", title: "笔记", kind: "notes", folder: "Notes" }],
    },
  });
  expect(limited.blocks[0].notes).toHaveLength(10);
  expect(limited.blocks[0].limited).toBe(true);
});
it("rejects traversal, hidden files, symlinks and oversized HTML without touching source data", async () => {
  const { root, pages, spec } = await fixture();
  for (const path of ["../secret.md", ".mindos/config.json", "/etc/passwd"])
    expect(() =>
      validatePageSpec({
        ...spec,
        blocks: [{ id: "n", title: "Notes", kind: "notes", paths: [path] }],
      }),
    ).toThrow();
  expect(() =>
    validatePageSpec({
      ...spec,
      blocks: [
        { id: "web", title: "Web", kind: "html", html: "x".repeat(100000) },
      ],
    }),
  ).toThrow();
  const outside = mkdtempSync(join(tmpdir(), "mindos-pages-external-"));
  roots.push(outside);
  writeFileSync(join(outside, "secret.md"), "private");
  mkdirSync(join(root, "Notes"));
  symlinkSync(join(outside, "secret.md"), join(root, "Notes", "secret.md"));
  const rendered = pages.preview({
    expectedRootId: pages.rootId,
    spec: {
      ...spec,
      blocks: [
        { id: "n", title: "Notes", kind: "notes", paths: ["Notes/secret.md"] },
      ],
    },
  });
  expect(rendered.blocks[0].error).toBeDefined();
  expect(JSON.stringify(rendered)).not.toContain("private");
});
it("honors saved filters and visible fields, and never broadens read-only view actions", async () => {
  const { work, tasks, pages, spec } = await fixture();
  const draft = await work.preview({
    collectionId: tasks.collection.id,
    spec: {
      ...tasks.view.spec,
      fields: ["title"],
      actions: [],
      filter: { all: [{ field: "status", op: "eq", value: "done" }] },
    },
  });
  await work.save({
    draftId: draft.draftId,
    viewId: tasks.view.id,
    expectedViewVersion: 1,
    operationId: randomUUID(),
  });
  const rendered = pages.preview({
    expectedRootId: pages.rootId,
    spec: { ...spec, blocks: [{ ...spec.blocks[0], viewId: tasks.view.id }] },
  });
  expect(rendered.blocks[0].data?.records).toEqual([]);
  expect(rendered.blocks[0].data?.spec.actions).toEqual([]);
});
it("limits history and preserves malformed metadata for inspection", async () => {
  const { root, pages, spec } = await fixture();
  let current = (
    await pages.save({
      spec,
      expectedVersion: 0,
      expectedRootId: pages.rootId,
      operationId: randomUUID(),
    })
  ).page;
  for (let i = 0; i < 22; i++)
    current = (
      await pages.save({
        pageId: current.id,
        spec: { ...spec, title: "Page " + i },
        expectedVersion: current.version,
        expectedRootId: pages.rootId,
        operationId: randomUUID(),
      })
    ).page;
  expect(current.history).toHaveLength(20);
  await expect(
    pages.restore({
      pageId: current.id,
      restoreVersion: 1,
      expectedVersion: current.version,
      expectedRootId: pages.rootId,
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "VERSION_MISSING" });
  writeFileSync(join(root, ".mindos/views/pages.json"), "{broken");
  expect(() => pages.list()).toThrow();
  expect(readFileSync(join(root, ".mindos/views/pages.json"), "utf8")).toBe(
    "{broken",
  );
});

it("keeps static custom blocks and notes usable when the collection registry is damaged", async () => {
  const { root, pages, spec } = await fixture();
  writeFileSync(join(root, ".mindos/views/index.json"), "{broken");
  mkdirSync(join(root, "Notes"));
  writeFileSync(join(root, "Notes/one.md"), "# 笔记");
  const rendered = pages.preview({
    expectedRootId: pages.rootId,
    spec: {
      ...spec,
      blocks: [
        {
          id: "web",
          title: "自定义网页",
          kind: "html",
          html: "<h1>Hello</h1>",
        },
        { id: "notes", title: "笔记", kind: "notes", paths: ["Notes/one.md"] },
        ...spec.blocks,
      ],
    },
  });
  expect(rendered.blocks[0].error).toBeUndefined();
  expect(rendered.blocks[1].notes).toHaveLength(1);
  expect(rendered.blocks[2].error?.code).toBe("REGISTRY_UNREADABLE");
});
it("prevents concurrent stale saves and cancelled operations from replacing the accepted page", async () => {
  const { pages, spec, root, work } = await fixture();
  const first = (
    await pages.save({
      spec,
      expectedVersion: 0,
      expectedRootId: pages.rootId,
      operationId: randomUUID(),
    })
  ).page;
  const results = await Promise.allSettled(
    ["A", "B"].map((title) =>
      pages.save({
        pageId: first.id,
        spec: { ...spec, title },
        expectedVersion: 1,
        expectedRootId: pages.rootId,
        operationId: randomUUID(),
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const controller = new AbortController();
  controller.abort();
  const cancelled = new WorkPagesService(root, work, controller.signal);
  await expect(
    cancelled.save({
      spec,
      expectedVersion: 0,
      expectedRootId: pages.rootId,
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  expect(pages.list().pages).toHaveLength(1);
  expect(pages.read(first.id).page.version).toBe(2);
});
it("clips long Unicode notes without corrupting text and handles an empty source folder", async () => {
  const { root, pages, spec } = await fixture();
  mkdirSync(join(root, "Notes"));
  const block = { id: "notes", title: "笔记", kind: "notes", folder: "Notes" };
  expect(
    pages.preview({
      expectedRootId: pages.rootId,
      spec: { ...spec, blocks: [block] },
    }).blocks[0].notes,
  ).toEqual([]);
  writeFileSync(join(root, "Notes/long.md"), "👩".repeat(5000));
  const data = pages.preview({
    expectedRootId: pages.rootId,
    spec: { ...spec, blocks: [block] },
  }).blocks[0];
  expect(data.limited).toBe(true);
  expect(data.notes![0].content).not.toContain("�");
  expect(Buffer.byteLength(data.notes![0].content)).toBeLessThanOrEqual(
    16 * 1024,
  );
});
it("rejects invalid or duplicated blocks, unknown properties and serialized-size limits", async () => {
  const { spec } = await fixture();
  for (const invalid of [
    null,
    {},
    { ...spec, blocks: [] },
    { ...spec, blocks: [spec.blocks[0], spec.blocks[0]] },
    { ...spec, layout: { columns: 3, density: "compact" } },
    { ...spec, script: "unsafe" },
  ])
    expect(() => validatePageSpec(invalid)).toThrow();
  expect(() =>
    validatePageSpec({
      ...spec,
      blocks: [
        { id: "web", title: "网页", kind: "html", html: "中".repeat(50000) },
      ],
    }),
  ).toThrow();
});

it("lets a collection-bound page choose schema fields while explicit saved-view bindings remain constrained", async () => {
  const { pages, spec, tasks } = await fixture();
  const direct = pages.preview({
    expectedRootId: pages.rootId,
    spec: {
      ...spec,
      blocks: [{ ...spec.blocks[0], fields: ["title", "personRef"] }],
    },
  });
  expect(direct.blocks[0].error).toBeUndefined();
  expect(direct.blocks[0].data?.spec.fields).toEqual(["title", "personRef"]);
  const saved = pages.preview({
    expectedRootId: pages.rootId,
    spec: {
      ...spec,
      blocks: [
        {
          ...spec.blocks[0],
          viewId: tasks.view.id,
          fields: ["title", "personRef"],
        },
      ],
    },
  });
  expect(saved.blocks[0].error?.code).toBe("INVALID_PAGE");
});

it("refuses internal metadata symlinks and does not redirect a page save into source folders", async () => {
  const root = mkdtempSync(join(tmpdir(), "mindos-page-link-"));
  roots.push(root);
  mkdirSync(join(root, "Notes"));
  mkdirSync(join(root, ".mindos"));
  symlinkSync(join(root, "Notes"), join(root, ".mindos/views"));
  const pages = new WorkPagesService(root);
  const spec = {
    specVersion: 1,
    title: "Page",
    layout: { columns: 1, density: "comfortable" },
    blocks: [{ id: "web", kind: "html", title: "Hello", html: "<p>Hello</p>" }],
  };
  await expect(
    pages.save({
      spec,
      expectedVersion: 0,
      expectedRootId: pages.rootId,
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  expect(() => readFileSync(join(root, "Notes/pages.json"))).toThrow();
});
it("uses deterministic creation identity so an old retry cannot duplicate an existing page after receipt compaction", async () => {
  const { root, pages, spec } = await fixture();
  const input = {
    spec,
    expectedVersion: 0,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  };
  await pages.save(input);
  const path = join(root, ".mindos/views/pages.json");
  const registry = JSON.parse(readFileSync(path, "utf8"));
  registry.operations = [];
  writeFileSync(path, JSON.stringify(registry));
  await expect(pages.save(input)).rejects.toMatchObject({
    code: "REVISION_CONFLICT",
  });
  expect(pages.list().pages).toHaveLength(1);
});

it("does not resurrect a removed page when old operation receipts have been compacted", async () => {
  const { root, pages, spec } = await fixture();
  const input = {
    spec,
    expectedVersion: 0,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  };
  const saved = await pages.save(input);
  await pages.remove({
    pageId: saved.page.id,
    expectedVersion: 1,
    expectedRootId: pages.rootId,
    operationId: randomUUID(),
  });
  const path = join(root, ".mindos/views/pages.json");
  const registry = JSON.parse(readFileSync(path, "utf8"));
  registry.operations = [];
  writeFileSync(path, JSON.stringify(registry));
  await expect(pages.save(input)).rejects.toMatchObject({
    code: "PAGE_MISSING",
  });
  expect(pages.list().pages).toHaveLength(0);
});

it("persists every operation ID accepted by the shared mutation contract", async () => {
  const { pages, spec } = await fixture();
  await pages.save({
    spec,
    expectedVersion: 0,
    expectedRootId: pages.rootId,
    operationId: "00000000-0000-0000-0000-000000000001",
  });
  expect(pages.list().pages).toHaveLength(1);
});

it("preserves readable metadata when the removed-page identity ledger reaches capacity", async () => {
  const { root, pages, spec } = await fixture();
  const { page } = await pages.save({ spec, expectedVersion: 0, expectedRootId: pages.rootId, operationId: randomUUID() });
  const path = join(root, ".mindos/views/pages.json");
  const registry = JSON.parse(readFileSync(path, "utf8"));
  registry.retiredPageIds = Array.from({ length: 100000 }, (_, index) => `page-retired-${index}`);
  const original = JSON.stringify(registry);
  writeFileSync(path, original);
  await expect(pages.remove({ pageId: page.id, expectedVersion: 1, expectedRootId: pages.rootId, operationId: randomUUID() })).rejects.toMatchObject({ code: "PAGES_CAPACITY" });
  expect(readFileSync(path, "utf8")).toBe(original);
  expect(pages.list().pages).toHaveLength(1);
});
