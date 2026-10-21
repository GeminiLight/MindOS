import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMindosApp } from "../app.js";
import { createDefaultMindosHttpServices } from "../services.js";
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function setup(token?: string) {
  const root = mkdtempSync(join(tmpdir(), "mindos-views-http-"));
  const changed: unknown[] = [];
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    readSettings: () => ({ mindRoot: root, authToken: token }),
  });
  const app = createMindosApp({
    services: {
      ...services,
      knowledgeWrites: { onChanged: (value) => changed.push(value) },
    },
    staticFallback: false,
  });
  cleanups.push(() => {
    services.dispose?.();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, app, changed };
}
async function index(app: ReturnType<typeof createMindosApp>) {
  return (await app.fetch(new Request("http://localhost/api/views"))).json();
}
async function post(app: ReturnType<typeof createMindosApp>, body: unknown) {
  return app.fetch(
    new Request("http://localhost/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
describe("views use the Product Server contract", () => {
  it("rejects unauthorized calls and sends no-store responses", async () => {
    const { app } = setup("secret");
    expect(
      (await app.fetch(new Request("http://localhost/api/views"))).status,
    ).toBe(401);
    const response = await app.fetch(
      new Request("http://localhost/api/views", {
        headers: { authorization: "Bearer secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects a stale knowledge root before creating data", async () => {
    const { app, root } = setup();
    const response = await post(app, {
      op: "create",
      expectedRootId: "old-root",
      name: "人脉",
      folder: "人脉",
      mode: "new",
      operationId: randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(readdirSync(root).filter((p) => p !== ".mindos")).toEqual([]);
  });
  it("writes real people through knowledge operations and refreshes host caches", async () => {
    const { app, root, changed } = setup();
    const { rootId } = await index(app);
    const created = await post(app, {
      op: "create",
      expectedRootId: rootId,
      name: "我的人脉",
      folder: "人脉",
      mode: "new",
      operationId: randomUUID(),
    });
    expect(created.status).toBe(200);
    const { view } = await created.json();
    const added = await post(app, {
      op: "person.create",
      expectedRootId: rootId,
      id: view.id,
      operationId: randomUUID(),
      expectedRevision: "", // New-person browser drafts have no source revision yet.
      fields: { name: "林若舟", background: "设计师", focus: "知识与工作流" },
    });
    expect(added.status).toBe(200);
    const { person } = await added.json();
    expect(readFileSync(join(root, person.path), "utf8")).toContain("林若舟");
    expect(changed.length).toBeGreaterThan(0);
    const files = await app.fetch(new Request("http://localhost/api/files"));
    expect(JSON.stringify(await files.json())).toContain("人脉");
  });
  it("returns a conflict rather than overwriting another Agent and excludes private sections in preparation", async () => {
    const { app, root } = setup();
    const { rootId } = await index(app);
    const { view } = await (
      await post(app, {
        op: "create",
        expectedRootId: rootId,
        name: "人脉",
        folder: "人脉",
        mode: "new",
        operationId: randomUUID(),
      })
    ).json();
    const { person } = await (
      await post(app, {
        op: "person.create",
        expectedRootId: rootId,
        id: view.id,
        operationId: randomUUID(),
        fields: { name: "林", background: "背景", focus: "关注" },
      })
    ).json();
    writeFileSync(
      join(root, person.path),
      readFileSync(join(root, person.path), "utf8") +
        "\n## 私人\nPRIVATE_ONLY\n",
    );
    const conflict = await post(app, {
      op: "person.update",
      expectedRootId: rootId,
      id: view.id,
      personId: person.id,
      path: person.path,
      expectedRevision: person.revision,
      fields: { name: "过期修改" },
    });
    expect(conflict.status).toBe(409);
    const params = new URLSearchParams({
      op: "person",
      id: view.id,
      personId: person.id,
      path: person.path,
      rootId,
    });
    const { person: latest } = await (
      await app.fetch(new Request("http://localhost/api/views?" + params))
    ).json();
    params.set("op", "prepare");
    params.set("selected", "background,private");
    params.set("expectedRevision", latest.revision);
    const prepared = await app.fetch(
      new Request("http://localhost/api/views?" + params),
    );
    expect(prepared.status).toBe(200);
    expect(JSON.stringify(await prepared.json())).not.toContain("PRIVATE_ONLY");
  });
  it("rejects invalid JSON operations, oversized requests and aborted writes", async () => {
    const { app } = setup();
    const { rootId } = await index(app);
    expect(
      (await post(app, { op: "unknown", expectedRootId: rootId })).status,
    ).toBe(400);
    expect(
      (
        await post(app, {
          op: "create",
          expectedRootId: rootId,
          name: "x".repeat(90_000),
        })
      ).status,
    ).toBe(413);
  });
});
