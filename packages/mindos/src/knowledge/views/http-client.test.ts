import { expect, it, vi } from "vitest";
import * as api from "./index.js";
it("sends the same root and revision contract without a filesystem fallback", async () => {
  const Client = (api as any).ViewsClient;
  expect(Client).toBeTypeOf("function");
  const fetcher = vi.fn(
    async (_url: any, init: any) =>
      new Response(
        JSON.stringify({ committed: true, input: JSON.parse(init.body) }),
        { status: 200 },
      ),
  );
  const client = new Client({
    baseUrl: "http://localhost:3456",
    token: "secret",
    fetch: fetcher,
  });
  const result = await client.request("mutate", {
    expectedRootId: "root",
    expectedRevision: "hash",
    operationId: "op",
  });
  expect(result.input.expectedRevision).toBe("hash");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  const bad = new Client({
    baseUrl: "http://localhost:3456",
    fetch: async () => {
      throw Error("offline");
    },
  });
  await expect(bad.request("list")).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
});
it("reads an existing preview with GET rather than creating another preview", async () => {
  const fetcher = vi.fn(async (_url: any, _init: any) => new Response("{}"));
  const c = new api.ViewsClient({
    baseUrl: "http://localhost:3456",
    fetch: fetcher,
  });
  await c.request("preview", { draftId: "d-12345678" });
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
  expect(String(fetcher.mock.calls[0][0])).toContain("draftId=d-12345678");
});
