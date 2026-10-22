import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry, withRegistry } from "./registry.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
it("rejects a registry overflow before replacing a readable registry", async () => {
  const root = mkdtempSync(join(tmpdir(), "views-limit-"));
  roots.push(root);
  const sample = {
    id: "v-00000001",
    name: "One",
    folder: "Projects",
    template: "tasks" as const,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await withRegistry(root, (r) => {
    r.views.push(sample);
  });
  const path = join(root, ".mindos/views/index.json"),
    before = readFileSync(path, "utf8");
  await expect(
    withRegistry(root, (r) => {
      r.views = Array.from({ length: 501 }, (_, i) => ({
        ...sample,
        id: "v-" + String(i).padStart(8, "0"),
      }));
    }),
  ).rejects.toThrow();
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(readRegistry(root).views).toHaveLength(1);
});

it("accepts the 500-entry boundary and refuses collection overflow without losing views", async () => {
  const root = mkdtempSync(join(tmpdir(), "views-limit-"));
  roots.push(root);
  const time = new Date().toISOString();
  await withRegistry(root, r => {
    r.views = Array.from({ length: 500 }, (_, i) => ({
      id: "v-" + String(i).padStart(8, "0"), name: "View " + i,
      folder: "Projects", template: "tasks", version: 1,
      createdAt: time, updatedAt: time,
    }));
  });
  expect(readRegistry(root).views).toHaveLength(500);
  const path = join(root, ".mindos/views/index.json");
  const before = readFileSync(path, "utf8");
  await expect(withRegistry(root, r => {
    r.collections.push(...Array.from({ length: 500 }, (_, i) => ({
      id: "c-" + String(i).padStart(8, "0"), folder: "Folder-" + i,
      template: "tasks" as const, schemaVersion: 1 as const,
    })));
  })).rejects.toThrow("500");
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(readRegistry(root).views).toHaveLength(500);
});
