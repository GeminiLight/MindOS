import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readRegistry, withRegistry } from "./registry.js";
const roots: string[] = [];
const root = () => {
  const r = mkdtempSync(join(tmpdir(), "views-v2-"));
  roots.push(r);
  mkdirSync(join(r, ".mindos/views"), { recursive: true });
  return r;
};
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
it("reads v1 without modifying disk and upgrades with an exact backup on first change", async () => {
  const r = root(),
    raw = JSON.stringify({
      schemaVersion: 1,
      views: [
        {
          id: "v-12345678",
          name: "People",
          folder: "People",
          template: "people",
          version: 4,
          createdAt: "2026-10-01",
          updatedAt: "2026-10-01",
        },
      ],
    });
  writeFileSync(join(r, ".mindos/views/index.json"), raw);
  const registry = readRegistry(r);
  expect(registry.schemaVersion).toBe(2);
  expect(readFileSync(join(r, ".mindos/views/index.json"), "utf8")).toBe(raw);
  await withRegistry(r, (reg) => {
    reg.views[0].name = "Renamed";
  });
  expect(
    readFileSync(join(r, ".mindos/views/registry-v1.backup.json"), "utf8"),
  ).toBe(raw);
  expect(readRegistry(r).views[0]).toMatchObject({
    id: "v-12345678",
    version: 4,
    name: "Renamed",
  });
});
it("refuses unsupported registries without recreating them", async () => {
  const r = root();
  writeFileSync(
    join(r, ".mindos/views/index.json"),
    '{"schemaVersion":99,"views":[]}',
  );
  await expect(withRegistry(r, () => {})).rejects.toThrow();
  expect(existsSync(join(r, ".mindos/views/registry-v1.backup.json"))).toBe(
    false,
  );
});
