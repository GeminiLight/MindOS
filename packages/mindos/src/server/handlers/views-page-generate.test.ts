import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { handlePageGenerate } from "./views-page-generate.js";
import { createDefaultMindosHttpServices } from "../services.js";
import { mindRootIdentity } from "../root-identity.js";
import { WorkViewsService } from "../../knowledge/views/service.js";
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "page-ai-"));
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    readSettings: () => ({ mindRoot: root }),
  });
  cleanups.push(() => {
    services.dispose?.();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, services, expectedRootId: mindRootIdentity(root) };
}
const spec = {
  specVersion: 1,
  title: "Work",
  layout: { columns: 1, density: "comfortable" },
  blocks: [
    { id: "intro", title: "Welcome", kind: "html", html: "<p>Hello</p>" },
  ],
};
it("returns a draft without registering a page or changing source data", async () => {
  const { root, services, expectedRootId } = fixture();
  const response = await handlePageGenerate(
    { expectedRootId, prompt: "Make it compact", spec },
    services,
    undefined,
    async () => ({
      text: JSON.stringify({
        spec: { ...spec, layout: { ...spec.layout, density: "compact" } },
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect((response.body as any).spec.layout.density).toBe("compact");
  expect(existsSync(join(root, ".mindos/views/pages.json"))).toBe(false);
});
it("checks root and selected scope before invoking a model", async () => {
  const { services, expectedRootId } = fixture();
  const model = vi.fn();
  expect(
    (
      await handlePageGenerate(
        { expectedRootId: "old", prompt: "Change", spec },
        services,
        undefined,
        model,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await handlePageGenerate(
        { expectedRootId, prompt: "Change", spec, selectedBlockId: "missing" },
        services,
        undefined,
        model,
      )
    ).status,
  ).toBe(400);
  expect(model).not.toHaveBeenCalled();
});
it("sends metadata rather than task bodies and rejects unavailable source bindings", async () => {
  const { root, services, expectedRootId } = fixture();
  const work = new WorkViewsService(root, async (o) => {
    mkdirSync(dirname(join(root, o.path)), { recursive: true });
    writeFileSync(join(root, o.path), o.content!);
  });
  const created = await work.create({
    name: "Tasks",
    folder: "Project",
    template: "tasks",
    mode: "new",
    operationId: randomUUID(),
  });
  const snap = work.read(created.collection.id);
  await work.mutate({
    collectionId: created.collection.id,
    action: "record.create",
    operationId: randomUUID(),
    expectedRevision: snap.revision,
    expectedSchemaRevision: snap.schemaRevision,
    input: { title: "PRIVATE_SOURCE_TOKEN" },
  });
  const generated = {
    ...spec,
    blocks: [
      {
        id: "tasks",
        title: "Project",
        kind: "tasks",
        collectionId: created.collection.id,
      },
    ],
  };
  const model = vi.fn(async () => ({
    text: JSON.stringify({ spec: generated }),
  }));
  expect(
    (
      await handlePageGenerate(
        { expectedRootId, prompt: "Show my project", spec },
        services,
        undefined,
        model,
      )
    ).status,
  ).toBe(200);
  expect(JSON.stringify(model.mock.calls)).not.toContain(
    "PRIVATE_SOURCE_TOKEN",
  );
});
it("propagates cancellation without producing a draft", async () => {
  const { services, expectedRootId } = fixture();
  const controller = new AbortController();
  controller.abort();
  const model = vi.fn();
  expect(
    (
      await handlePageGenerate(
        { expectedRootId, prompt: "Change", spec },
        services,
        controller.signal,
        model,
      )
    ).status,
  ).toBe(408);
  expect(model).not.toHaveBeenCalled();
});
