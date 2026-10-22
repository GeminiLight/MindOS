// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  sanitizePageHtml,
  createPageDocument,
  pagePublicData,
} from "@/lib/views/page-sandbox";
describe("custom page boundary", () => {
  it("retains styled content and extracts only worker programs", () => {
    const result = sanitizePageHtml(
      '<style>.card{padding:12px}</style><article class="card"><h2>林悦</h2><button data-mindos-action="task.complete" data-record-id="t-1">完成</button></article><script type="mindos/page">render("Hi")</script>',
    );
    expect(result.html).toContain("林悦");
    expect(result.html).toContain("data-record-id");
    expect(result.code).toBe('render("Hi")');
    expect(result.html).not.toContain("<script");
  });
  it("removes executable markup, navigation and external resources", () => {
    const result = sanitizePageHtml(
      '<meta http-equiv="refresh" content="0;url=https://evil.test"><iframe src="https://evil.test"></iframe><script>alert(1)</script><img src="https://evil.test" onerror="alert(2)"><a href="javascript:alert(3)">Go</a><svg onload="alert(4)"></svg><form action="https://evil.test">send</form>',
    );
    expect(result.html).not.toMatch(
      /evil|onerror|javascript|<script|<iframe|<svg|<form|http-equiv/,
    );
    expect(result.code).toBe("");
  });
  it("handles empty input and refuses oversized markup", () => {
    expect(sanitizePageHtml("").html).toBe("");
    expect(() => sanitizePageHtml("x".repeat(140000))).toThrow(/large/);
  });
  it("binds only display records and excludes root, revisions and credential-like metadata", () => {
    expect(
      pagePublicData({
        rootId: "secret-root",
        revision: "r",
        collection: { id: "c", template: "tasks", folder: "private" },
        fields: { title: "text" },
        records: [
          {
            id: "t",
            fields: { title: "Task" },
            source: { path: "private", revision: "r" },
            rootId: "secret",
          },
        ],
      }),
    ).toEqual({
      collection: { id: "c", template: "tasks" },
      fields: { title: "text" },
      records: [{ id: "t", fields: { title: "Task" } }],
    });
  });
  it("keeps user markup inside encoded data and applies a restrictive runtime policy", () => {
    const html = createPageDocument(
      "</script><script>evil()</script>",
      {},
      "nonce-token",
      "http://localhost:4587",
      {},
    );
    expect(html.match(/<script nonce=/g)).toHaveLength(1);
    expect(html).not.toContain("</script><script>evil");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).not.toContain("allow-same-origin");
  });
});

it("projects only fields exposed by the page block before passing data to untrusted code", () => {
  const result = pagePublicData({
    fields: { title: "text", status: "enum", x_private: "text" },
    spec: { fields: ["title"] },
    records: [
      {
        id: "t",
        fields: { title: "Task", status: "todo", x_private: "secret" },
      },
    ],
  });
  expect(result.fields).toEqual({ title: "text" });
  expect(result.records).toEqual([{ id: "t", fields: { title: "Task" } }]);
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("accepts data only from the bound host and keeps committed Worker state when data refreshes", () => {
  const calls: any[] = [];
  class WorkerStub {
    onmessage?: (event: any) => void;
    terminate() {}
    postMessage(value: any) {
      calls.push(value);
      this.onmessage?.({ data: { html: "<p>Rendered</p>", state: { count: 2 } } });
    }
  }
  vi.stubGlobal("Worker", WorkerStub);
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  const add = vi.spyOn(window, "addEventListener");
  try {
    document.body.innerHTML = '<main id="surface"></main><p id="runtime-status"></p>';
    const doc = createPageDocument('<script type="mindos/page">render("Ready",state)</script>', { value: 1 }, "bound-token", window.location.origin, {});
    const script = new DOMParser().parseFromString(doc, "text/html").querySelector("script")!.textContent!;
    new Function(script)();
    expect(calls).toHaveLength(1);
    const listener = add.mock.calls.find(([type]) => type === "message")?.[1] as (event: MessageEvent) => void;
    expect(listener).toBeTypeOf("function");
    const send = (overrides: any = {}, data: any = {}) => listener(new MessageEvent("message", {
      source: window, origin: window.location.origin,
      data: { channel: "mindos-page", type: "data", nonce: "bound-token", data: { value: 2 }, ...data }, ...overrides,
    }));
    send({ source: null });
    send({ origin: "https://wrong.test" });
    send({}, { nonce: "old" });
    expect(calls).toHaveLength(1);
    send();
    expect(calls[1]).toEqual({ data: { value: 2 }, state: { count: 2 }, event: null });
    window.removeEventListener("message", listener);
  } finally {
    add.mockRestore();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  }
});
