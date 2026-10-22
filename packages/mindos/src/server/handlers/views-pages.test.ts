import { afterEach, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMindosApp } from "../app.js";
import { createDefaultMindosHttpServices } from "../services.js";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
const spec = (title = "My workspace", html = "<h1>Welcome</h1>") => ({
  specVersion: 1,
  title,
  layout: { columns: 1, density: "comfortable" },
  blocks: [{ id: "welcome", title: "Welcome", kind: "html", html }],
});
function setup(token?: string) {
  const root = mkdtempSync(join(tmpdir(), "pages-http-"));
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    readSettings: () => ({ mindRoot: root, authToken: token }),
  });
  const app = createMindosApp({ services, staticFallback: false });
  cleanups.push(() => {
    services.dispose?.();
    rmSync(root, { recursive: true, force: true });
  });
  const get = (query = "op=page.list", authorization?: string) =>
    app.fetch(new Request(`http://localhost/api/views/v2?${query}`, {
      headers: authorization ? { authorization } : {},
    }));
  const post = (body: unknown, authorization?: string, signal?: AbortSignal) =>
    app.fetch(new Request("http://localhost/api/views/v2", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body), signal,
    }));
  return { root, app, get, post };
}

it("requires authentication before every page read, preview, write and generation", async () => {
  const { root, get, post } = setup("page-secret");
  for (const op of ["page.list", "page.read", "page.data"])
    expect((await get(`op=${op}`)).status).toBe(401);
  for (const op of ["page.preview", "page.save", "page.restore", "page.remove", "page.generate"])
    expect((await post({ op, spec: spec() }, "Bearer wrong")).status).toBe(401);
  const authenticated = await get("op=page.list", "Bearer page-secret");
  expect(authenticated.status).toBe(200);
  expect(await authenticated.json()).toMatchObject({ pages: [] });
  expect(authenticated.headers.get("cache-control")).toBe("private, no-store");
  expect(authenticated.headers.get("x-content-type-options")).toBe("nosniff");
  expect(existsSync(join(root, ".mindos/views/pages.json"))).toBe(false);
});

it("rejects missing or stale roots before every mutation and guards scoped reads", async () => {
  const { root, get, post } = setup();
  for (const op of ["page.preview", "page.save", "page.restore", "page.remove", "page.generate"]) {
    expect((await post({ op, spec: spec() })).status).toBe(409);
    expect((await post({ op, expectedRootId: "stale", spec: spec() })).status).toBe(409);
  }
  for (const op of ["page.list", "page.read", "page.data"])
    expect((await get(`op=${op}&rootId=stale`)).status).toBe(409);
  expect(existsSync(join(root, ".mindos/views/pages.json"))).toBe(false);
});

it("previews without persistence and saves, restores and removes only page metadata", async () => {
  const { root, get, post } = setup();
  writeFileSync(join(root, "business.md"), "# Business data\nUntouched\n");
  const { rootId } = await (await get()).json();
  const request = (body: Record<string, unknown>) => post({ expectedRootId: rootId, ...body });
  const preview = await request({ op: "page.preview", spec: spec() });
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ rootId, spec: spec(), blocks: [{ blockId: "welcome" }] });
  expect(existsSync(join(root, ".mindos/views/pages.json"))).toBe(false);
  const creation = { op: "page.save", spec: spec(), expectedVersion: 0, operationId: randomUUID() };
  const created = await request(creation);
  expect(created.status).toBe(200);
  const { page } = await created.json();
  expect(page.version).toBe(1);
  expect((await (await request(creation)).json()).page.id).toBe(page.id);
  const update = await request({ op: "page.save", pageId: page.id, spec: spec("Updated"), expectedVersion: 1, operationId: randomUUID() });
  expect(update.status).toBe(200);
  expect((await update.json()).page.version).toBe(2);
  const stale = await request({ op: "page.save", pageId: page.id, spec: spec("Lost update"), expectedVersion: 1, operationId: randomUUID() });
  expect(stale.status).toBe(409);
  const list = await (await get()).json();
  expect(list.pages).toHaveLength(1);
  expect(list.pages[0]).not.toHaveProperty("history");
  expect(list.pages[0].spec.title).toBe("Updated");
  const restored = await request({ op: "page.restore", pageId: page.id, expectedVersion: 2, restoreVersion: 1, operationId: randomUUID() });
  expect(restored.status).toBe(200);
  expect((await restored.json()).page).toMatchObject({ version: 3, spec: spec() });
  for (const op of ["page.read", "page.data"]) {
    const response = await get(`op=${op}&pageId=${page.id}&rootId=${rootId}`);
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: page.id, version: 3 });
  }
  expect((await request({ op: "page.remove", pageId: page.id, expectedVersion: 2, operationId: randomUUID() })).status).toBe(409);
  expect((await request({ op: "page.remove", pageId: page.id, expectedVersion: 3, operationId: randomUUID() })).status).toBe(200);
  expect((await (await get()).json()).pages).toEqual([]);
  expect((await get(`op=page.read&pageId=${page.id}`)).status).toBe(404);
  expect(readFileSync(join(root, "business.md"), "utf8")).toBe("# Business data\nUntouched\n");
});

it("accepts supported large pages while rejecting excessive bodies, malformed JSON and unknown ops", async () => {
  const { root, app, get, post } = setup();
  const { rootId } = await (await get()).json();
  expect((await post({ op: "page.preview", expectedRootId: rootId, spec: spec("Large", "x".repeat(85_000)) })).status).toBe(200);
  expect((await post({ op: "page.preview", expectedRootId: rootId, padding: "x".repeat(160_000), spec: spec() })).status).toBe(413);
  const malformed = await app.fetch(new Request("http://localhost/api/views/v2", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{broken",
  }));
  expect(malformed.status).toBe(400);
  expect((await get("op=page.unknown")).status).toBe(400);
  expect((await post({ op: "page.unknown", expectedRootId: rootId })).status).toBe(400);
  const abort = new AbortController();
  abort.abort();
  expect((await post({ op: "page.save", expectedRootId: rootId, expectedVersion: 0, operationId: randomUUID(), spec: spec() }, undefined, abort.signal)).status).toBe(499);
  expect(existsSync(join(root, ".mindos/views/pages.json"))).toBe(false);
});
