// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Editor from "@/components/studio/views/WorkRecordEditor";
import { readViewDraft } from "@/lib/views/drafts";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/views/work-api", () => ({ workRequest: api.request }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const data = {
  rootId: "root",
  collection: { id: "tasks", template: "tasks" },
  fields: {
    title: "text",
    status: "enum",
    dueDate: "date",
    personRef: "text",
    sourcePath: "text",
    x_notes: "text",
  },
  revision: "original",
  schemaRevision: "schema",
  records: [],
} as any;
const record = {
  id: "t1",
  fields: {
    title: "Review",
    status: "todo",
    dueDate: "",
    sourcePath: "",
    personRef: "",
    x_notes: "Keep me",
  },
  source: { revision: "original" },
} as any;
beforeEach(() => {
  localStorage.clear();
  api.request.mockReset();
  api.request.mockResolvedValue({ rootId: "root", collections: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function change(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("uses a date picker and hides optional metadata while retaining existing values on save", async () => {
  const saved = vi.fn();
  await act(async () =>
    root.render(
      <Editor
        data={data}
        record={record}
        locale="en"
        saved={saved}
        close={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("Edit task");
  expect(host.querySelector('input[type="date"]')).not.toBeNull();
  expect(host.querySelector("details")).not.toBeNull();
  await submit();
  expect(api.request).toHaveBeenLastCalledWith(
    "mutate",
    expect.objectContaining({
      expectedRevision: "original",
      input: expect.objectContaining({ x_notes: "Keep me" }),
    }),
  );
  expect(saved).toHaveBeenCalled();
});
it("rejects whitespace-only titles before sending and keeps a failed save as a recoverable draft", async () => {
  const saved = vi.fn();
  await act(async () =>
    root.render(
      <Editor
        data={data}
        record={record}
        locale="en"
        saved={saved}
        close={vi.fn()}
      />,
    ),
  );
  const title = host.querySelector('input[name="title"]') as HTMLInputElement;
  expect(title).not.toBeNull();
  await change(title, "   ");
  await submit();
  expect(api.request.mock.calls.filter(([op]) => op === "mutate")).toHaveLength(
    0,
  );
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    "task title",
  );
  await change(title, "New title");
  api.request.mockRejectedValueOnce(new Error("File changed"));
  await submit();
  expect(host.textContent).toContain("File changed");
  expect(saved).not.toHaveBeenCalled();
  expect(
    readViewDraft({
      rootId: "root",
      viewId: "tasks",
      personId: "t1",
      kind: "work-record",
    })?.values.title,
  ).toBe("New title");
});
