import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as api from "./index.js";
it("notifies another host of hidden registry changes without sending record content", async () => {
  expect((api as any).watchViews).toBeTypeOf("function");
  const root = mkdtempSync(join(tmpdir(), "views-watch-"));
  mkdirSync(join(root, ".mindos/views"), { recursive: true });
  let stop = () => {};
  try {
    const event = await new Promise<any>((resolve) => {
      stop = (api as any).watchViews(root, resolve, 25);
      writeFileSync(
        join(root, ".mindos/views/index.json"),
        '{"secret":"not in event"}',
      );
    });
    expect(event).toMatchObject({ type: "views.changed" });
    expect(JSON.stringify(event)).not.toContain("secret");
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});
