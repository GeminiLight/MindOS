// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Frame from "@/components/studio/pages/CustomPageFrame";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/views/work-api", () => ({ workRequest: api.request }));
vi.mock("@/lib/stores/locale-store", () => ({
  useLocale: () => ({ locale: "en" }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const snapshot = {
  rootId: "root",
  collection: { id: "c-tasks123", template: "tasks" },
  revision: "r1",
  schemaRevision: "s1",
  fields: { title: "text", status: "enum" },
  spec: {
    collectionId: "c-tasks123",
    fields: ["title", "status"],
    actions: ["record.update", "source.open"],
  },
  records: [
    {
      id: "t-task123",
      fields: { title: "Task", status: "todo" },
      source: { path: "Project/TODO.csv" },
    },
  ],
} as any;
beforeEach(() => {
  api.request.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(readOnly = false, data = snapshot) {
  await act(async () =>
    root.render(
      <Frame
        html="<p>Custom</p>"
        data={data}
        title="Custom"
        rootId="root"
        readOnly={readOnly}
      />,
    ),
  );
}
async function message(overrides: any = {}) {
  const frame = host.querySelector("iframe")!;
  const nonce = frame.srcdoc.match(/nonce="([a-z0-9-]+)"/)![1];
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: frame.contentWindow,
        data: {
          channel: "mindos-page",
          nonce,
          type: "action",
          action: "task.complete",
          recordId: "t-task123",
          ...overrides,
        },
      }),
    ),
  );
}
it("ignores action messages in previews even when the bound source allows updates", async () => {
  await render(true);
  await message();
  expect(host.textContent).not.toContain("Mark “Task” complete");
  expect(api.request).not.toHaveBeenCalled();
});
it("rejects messages from another frame and stale session tokens", async () => {
  await render();
  await message({ nonce: "old" });
  expect(host.textContent).not.toContain("Mark “Task” complete");
  const frame = host.querySelector("iframe")!;
  const nonce = frame.srcdoc.match(/nonce="([a-z0-9-]+)"/)![1];
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: window,
        data: {
          channel: "mindos-page",
          nonce,
          type: "action",
          action: "task.complete",
          recordId: "t-task123",
        },
      }),
    ),
  );
  expect(host.textContent).not.toContain("Mark “Task” complete");
});
it("rechecks field visibility before a confirmed write and preserves data when permissions changed", async () => {
  await render();
  await message();
  expect(host.textContent).toContain("Mark “Task” complete");
  api.request.mockResolvedValue({
    ...snapshot,
    view: { id: "v-view123", spec: { ...snapshot.spec, fields: ["title"] } },
  });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((el) => el.textContent === "Complete task")!
      .click(),
  );
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(api.request).not.toHaveBeenCalledWith("mutate", expect.anything());
  expect(host.textContent).toContain("changed");
});
it("does not submit duplicate completion requests and treats an already completed task as a successful refresh", async () => {
  await render();
  await message();
  api.request.mockResolvedValue({
    ...snapshot,
    records: [
      { ...snapshot.records[0], fields: { title: "Task", status: "done" } },
    ],
  });
  const confirm = Array.from(host.querySelectorAll("button")).find(
    (el) => el.textContent === "Complete task",
  )!;
  await act(async () => {
    confirm.click();
    confirm.click();
  });
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(api.request).not.toHaveBeenCalledWith("mutate", expect.anything());
});

it("rejects a valid token presented with the wrong origin", async () => {
  await render();
  const frame = host.querySelector("iframe")!,
    nonce = frame.srcdoc.match(/nonce="([a-z0-9-]+)"/)![1];
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: {
          channel: "mindos-page",
          nonce,
          type: "action",
          action: "task.complete",
          recordId: "t-task123",
        },
      }),
    ),
  );
  expect(host.textContent).not.toContain("Mark “Task” complete");
});
it("does not finish a write when its page becomes a read-only preview during the fresh read", async () => {
  await render();
  await message();
  let release!: (value: any) => void;
  api.request.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((el) => el.textContent === "Complete task")!
      .click(),
  );
  await render(true);
  await act(async () => release(snapshot));
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("Mark “Task” complete");
});
it("does not finish a write after the active knowledge library changes", async () => {
  await render();
  await message();
  let release!: (value: any) => void;
  api.request.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((el) => el.textContent === "Complete task")!
      .click(),
  );
  await act(async () =>
    root.render(
      <Frame
        html="<p>Custom</p>"
        data={{ ...snapshot, rootId: "other" }}
        title="Custom"
        rootId="other"
      />,
    ),
  );
  await act(async () => release(snapshot));
  expect(api.request).toHaveBeenCalledTimes(1);
});
it("updates the custom page palette when the host theme changes", async () => {
  await render();
  const frame = host.querySelector("iframe")!;
  const old = frame.srcdoc;
  await act(async () => {
    document.documentElement.style.setProperty("--background", "rgb(20, 20, 20)");
    document.documentElement.classList.add("dark");
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(frame.srcdoc).not.toBe(old);
  expect(frame.srcdoc).toContain("--background:rgb(20, 20, 20)");
  document.documentElement.style.removeProperty("--background");
  document.documentElement.classList.remove("dark");
});

it("sends projected data updates into the existing ready session without rebuilding its document", async () => {
  await render();
  const frame = host.querySelector("iframe")!, original = frame.srcdoc;
  const nonce = original.match(/nonce="([a-z0-9-]+)"/)![1];
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  await message({ type: "ready" });
  await render(false, { ...snapshot, records: [{ ...snapshot.records[0], fields: { title: "Updated", status: "done", private: "secret" } }] });
  expect(frame.srcdoc).toBe(original);
  expect(post).toHaveBeenCalledWith({ channel: "mindos-page", nonce, type: "data", data: {
    collection: snapshot.collection, fields: snapshot.fields,
    records: [{ id: "t-task123", fields: { title: "Updated", status: "done" } }],
  } }, "*");
  expect(JSON.stringify(post.mock.calls)).not.toContain("secret");
});

it("delivers the latest update after ready and rejects a pending confirmation whose source was removed", async () => {
  await render();
  const frame = host.querySelector("iframe")!, original = frame.srcdoc;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  await message();
  let release!: (value: any) => void;
  api.request.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await act(async () => Array.from(host.querySelectorAll("button")).find(el => el.textContent === "Complete task")!.click());
  await render(false, { ...snapshot, records: [] });
  expect(frame.srcdoc).toBe(original);
  expect(post).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Mark “Task” complete");
  await message({ type: "ready" });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "data", data: expect.objectContaining({ records: [] }) }), "*");
  await act(async () => release(snapshot));
  expect(api.request).not.toHaveBeenCalledWith("mutate", expect.anything());
});

it("dismisses confirmation when a new binding reuses the same record ID without resetting the frame", async () => {
  await render();
  await message();
  const original = host.querySelector("iframe")!.srcdoc;
  await render(false, { ...snapshot, collection: { ...snapshot.collection, id: "c-other123" } });
  expect(host.querySelector("iframe")!.srcdoc).toBe(original);
  expect(host.textContent).not.toContain("Mark “Task” complete");
  expect(api.request).not.toHaveBeenCalled();
});
