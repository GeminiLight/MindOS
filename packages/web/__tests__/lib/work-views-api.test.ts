// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/files-changed", () => ({ notifyFilesChanged: vi.fn() }));
import { workRequest } from "@/lib/views/work-api";
afterEach(() => vi.unstubAllGlobals());
it("attributes browser writes to the human and reads existing previews without mutation", async () => {
  const fetcher = vi.fn(async (_url: any, _init: any) => ({
    ok: true,
    json: async () => ({ committed: true }),
  }));
  vi.stubGlobal("fetch", fetcher);
  await workRequest("mutate", { operationId: "id" });
  expect(fetcher.mock.calls[0][1].headers["X-MindOS-Source"]).toBe("user");
  await workRequest("preview", { draftId: "d-12345678" });
  expect(fetcher.mock.calls[1][1].method).toBe("GET");
});
