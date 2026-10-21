import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import * as api from "./index.js";
import { documentRevision } from "./markdown.js";
const roots: string[] = [];
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "view-ops-"));
  roots.push(root);
  writeFileSync(join(root, "record.md"), "before");
  return root;
};
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
const run = (...args: any[]) => (api as any).commitViewMutation(...args);
const write = (r: string) => async (o: any) => {
  mkdirSync(dirname(join(r, o.path)), { recursive: true });
  writeFileSync(join(r, o.path), o.content);
};
it("serializes concurrent writers, rejects stale revisions and makes retries idempotent", async () => {
  expect((api as any).commitViewMutation).toBeTypeOf("function");
  const r = setup(),
    request = {
      operationId: "11111111-1111-4111-8111-111111111111",
      path: "record.md",
      expectedRevision: documentRevision("before"),
      input: { text: "after" },
    };
  const result = await Promise.allSettled([
    run(r, request, () => "after", write(r)),
    run(
      r,
      { ...request, operationId: "22222222-2222-4222-8222-222222222222" },
      () => "other",
      write(r),
    ),
  ]);
  expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(readFileSync(join(r, "record.md"), "utf8")).toBe("after");
  expect(
    await run(
      r,
      request,
      () => {
        throw Error("must replay");
      },
      write(r),
    ),
  ).toMatchObject({ committed: true });
  await expect(
    run(r, { ...request, input: { text: "different" } }, () => "", write(r)),
  ).rejects.toThrow();
});
it("recovers a prepared write after the data was committed and never overwrites later changes", async () => {
  expect((api as any).commitViewMutation).toBeTypeOf("function");
  const r = setup(),
    req = {
      operationId: "33333333-3333-4333-8333-333333333333",
      path: "record.md",
      expectedRevision: documentRevision("before"),
      input: {},
    };
  await expect(
    run(
      r,
      req,
      () => "after",
      async (o: any) => {
        await write(r)(o);
        throw Error("crash");
      },
    ),
  ).rejects.toThrow();
  expect(await run(r, req, () => "", write(r))).toMatchObject({
    committed: true,
  });
  const r2 = setup();
  await expect(
    run(
      r2,
      req,
      () => "after",
      async () => {
        throw Error("disk full");
      },
    ),
  ).rejects.toThrow();
  writeFileSync(join(r2, "record.md"), "external");
  await expect(run(r2, req, () => "", write(r2))).rejects.toThrow();
  expect(readFileSync(join(r2, "record.md"), "utf8")).toBe("external");
});
