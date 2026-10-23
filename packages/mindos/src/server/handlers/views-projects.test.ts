import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMindosApp } from "../app.js";
import { createDefaultMindosHttpServices } from "../services.js";
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
function setup(authToken?: string) {
  const root = mkdtempSync(join(tmpdir(), "project-http-"));
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    readSettings: () => ({ mindRoot: root, authToken }),
  });
  const app = createMindosApp({ services, staticFallback: false });
  cleanup.push(() => {
    services.dispose?.();
    rmSync(root, { recursive: true, force: true });
  });
  const get = (op: string, extra = "") =>
    app.fetch(new Request("http://localhost/api/views/v2?op=" + op + extra));
  const post = (value: unknown) =>
    app.fetch(
      new Request("http://localhost/api/views/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      }),
    );
  return { get, post };
}
it("authenticates every project operation before reading or writing metadata", async () => {
  const { get, post } = setup("secret");
  for (const op of ["project.list", "project.read"])
    expect((await get(op)).status).toBe(401);
  for (const op of ["project.save", "project.page", "project.interact"])
    expect((await post({ op })).status).toBe(401);
});
it("persists a project, opens one page and rejects stale roots and revisions", async () => {
  const { get, post } = setup();
  const first = await get("project.list");
  expect(first.status).toBe(200);
  const { rootId } = await first.json();
  const project = {
    id: "产品发布",
    title: "产品发布",
    goal: "连接资料",
    taskCollectionIds: [],
    personRefs: [],
  };
  expect((await post({ op: "project.save", project })).status).toBe(409);
  const save = {
    op: "project.save",
    project,
    expectedRootId: rootId,
    expectedVersion: 0,
    operationId: randomUUID(),
  };
  expect((await post(save)).status).toBe(200);
  expect((await post(save)).status).toBe(200);
  expect((await post({ ...save, operationId: randomUUID() })).status).toBe(409);
  const page = await post({
    op: "project.page",
    projectId: project.id,
    expectedRootId: rootId,
  });
  expect(page.status).toBe(200);
  const saved = await page.json();
  expect(saved.page.spec.projectId).toBe(project.id);
  expect(
    (
      await get(
        "project.read",
        "&projectId=" + encodeURIComponent(project.id) + "&rootId=stale",
      )
    ).status,
  ).toBe(409);
  expect((await get("project.read", "&projectId=missing")).status).toBe(404);
  expect(first.headers.get("cache-control")).toBe("private, no-store");
});
