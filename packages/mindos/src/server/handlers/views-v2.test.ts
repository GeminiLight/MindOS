import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMindosApp } from "../app.js";
import { createDefaultMindosHttpServices } from "../services.js";
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));
function setup(token?: string) {
  const root = mkdtempSync(join(tmpdir(), "views-http-v2-")),
    services = createDefaultMindosHttpServices({
      homeDir: root,
      readSettings: () => ({ mindRoot: root, authToken: token }),
    });
  const changed: unknown[] = [];
  const app = createMindosApp({
    services: {
      ...services,
      knowledgeWrites: { onChanged: (e) => changed.push(e) },
    },
    staticFallback: false,
  });
  cleanup.push(() => {
    services.dispose?.();
    rmSync(root, { recursive: true, force: true });
  });
  return { app, changed };
}
it("exposes authenticated capabilities and rejects stale roots before writing", async () => {
  const { app } = setup();
  const res = await app.fetch(
    new Request("http://localhost/api/views/v2?op=describe"),
  );
  expect(res.status).toBe(200);
  const info = await res.json();
  expect(info.capabilityVersion).toBe(1);
  const post = await app.fetch(
    new Request("http://localhost/api/views/v2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "create",
        expectedRootId: "old",
        name: "Tasks",
        folder: "Project",
        template: "tasks",
        mode: "new",
        operationId: randomUUID(),
      }),
    }),
  );
  expect(post.status).toBe(409);
  const locked = setup("secret");
  expect(
    (await locked.app.fetch(new Request("http://localhost/api/views/v2")))
      .status,
  ).toBe(401);
});
it("uses the product write path and returns committed task changes to another client", async () => {
  const { app, changed } = setup();
  const initial = await (
    await app.fetch(new Request("http://localhost/api/views/v2"))
  ).json();
  const post = async (body: any) => {
    const res = await app.fetch(
      new Request("http://localhost/api/views/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, expectedRootId: initial.rootId }),
      }),
    );
    expect(res.status).toBe(200);
    return res.json();
  };
  const c = await post({
    op: "create",
    name: "Tasks",
    folder: "Project",
    template: "tasks",
    mode: "new",
    operationId: randomUUID(),
  });
  const snap = await (
    await app.fetch(
      new Request(
        "http://localhost/api/views/v2?op=read&collectionId=" + c.collection.id,
      ),
    )
  ).json();
  await post({
    op: "mutate",
    collectionId: c.collection.id,
    action: "record.create",
    operationId: randomUUID(),
    expectedRevision: snap.revision,
    expectedSchemaRevision: snap.schemaRevision,
    input: { title: "From Agent" },
  });
  const next = await (
    await app.fetch(
      new Request(
        "http://localhost/api/views/v2?op=read&collectionId=" + c.collection.id,
      ),
    )
  ).json();
  expect(next.records[0].fields.title).toBe("From Agent");
  const page = await (
    await app.fetch(
      new Request(
        "http://localhost/api/views/v2?op=read&collectionId=" +
          c.collection.id +
          "&offset=1&limit=1",
      ),
    )
  ).json();
  expect(page).toMatchObject({ records: [], total: 1, nextOffset: null });
  expect(
    (
      await app.fetch(
        new Request(
          "http://localhost/api/views/v2?op=read&collectionId=" +
            c.collection.id +
            "&limit=-1",
        ),
      )
    ).status,
  ).toBe(400);
  expect(changed.length).toBeGreaterThanOrEqual(2);
});

it("guards the related-work read against wrong libraries and missing people", async () => {
  const { app } = setup();
  expect(
    (
      await app.fetch(
        new Request(
          "http://localhost/api/views/v2?op=related&rootId=wrong",
        ),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await app.fetch(
        new Request(
          "http://localhost/api/views/v2?op=related&collectionId=c-missing123&personId=p-missing123",
        ),
      )
    ).status,
  ).toBe(404);
  const locked = setup("secret");
  expect(
    (
      await locked.app.fetch(
        new Request("http://localhost/api/views/v2?op=related"),
      )
    ).status,
  ).toBe(401);
});
