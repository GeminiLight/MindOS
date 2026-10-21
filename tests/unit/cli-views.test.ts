import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MINDOS_CORE_COMMANDS } from "../../packages/mindos/src/cli.js";
it("registers views and provides a JSON client with safe deep links", async () => {
  expect(MINDOS_CORE_COMMANDS).toContain("views");
  const path = resolve("packages/mindos/bin/commands/views.js");
  expect(existsSync(path)).toBe(true);
  const module = await import(path);
  expect(module.viewUrl("http://localhost:4567", "v-12345678")).toBe(
    "http://localhost:4567/studio/views/v-12345678",
  );
  expect(() => module.viewUrl("http://localhost:4567", "../bad")).toThrow();
});
