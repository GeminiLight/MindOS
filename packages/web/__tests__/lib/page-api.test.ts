// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { pageRequest } from "@/lib/views/page-api";
vi.mock("@/lib/files-changed", () => ({ notifyFilesChanged: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it("reads page queries without posting and sends saves with explicit context", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ rootId: "root" }),
  });
  vi.stubGlobal("fetch", fetch);
  await pageRequest("page.read", { pageId: "p-one", rootId: "root" });
  expect(fetch.mock.calls[0][0].searchParams.get("pageId")).toBe("p-one");
  expect(fetch.mock.calls[0][1].method).toBe("GET");
  await pageRequest("page.save", {
    expectedRootId: "root",
    expectedVersion: 2,
  });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
    op: "page.save",
    expectedRootId: "root",
    expectedVersion: 2,
  });
});
it("preserves actionable errors and rejects invalid server responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        code: "PAGE_CONFLICT",
        message: "The page changed",
      }),
    }),
  );
  await expect(pageRequest("page.save")).rejects.toMatchObject({
    code: "PAGE_CONFLICT",
    message: "The page changed",
    status: 409,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    }),
  );
  await expect(pageRequest("page.list")).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});
