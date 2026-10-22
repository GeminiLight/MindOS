import { expect, it, vi } from "vitest";
import { ViewsClient } from "./views-client.js";
it("uses POST for page preview, generation and versioned mutations without serializing JSON into query strings", async () => {
  const fetcher = vi.fn(async () => new Response("{}"));
  const c = new ViewsClient({
    baseUrl: "http://localhost:3456",
    fetch: fetcher,
  });
  for (const op of [
    "page.preview",
    "page.generate",
    "page.save",
    "page.restore",
    "page.remove",
  ]) {
    await c.request(op, {
      expectedRootId: "root",
      spec: { title: "中文" },
      expectedVersion: 1,
    });
    const [url, init] = fetcher.mock.calls.at(-1) as any;
    expect(init.method).toBe("POST");
    expect(new URL(url).search).toBe("");
    expect(JSON.parse(init.body).spec.title).toBe("中文");
  }
  await c.request("page.read", { pageId: "page-12345678", rootId: "root" });
  expect((fetcher.mock.calls.at(-1) as any)[1].method).toBe("GET");
});
