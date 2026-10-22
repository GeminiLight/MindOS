// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PageCanvas from "@/components/studio/pages/PageCanvas";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/views/work-api", () => ({ workRequest: api.request }));
vi.mock("next/link", () => ({
  default: ({ children, ...p }: any) => <a {...p}>{children}</a>,
}));
vi.mock("@/components/studio/pages/CustomPageFrame", () => ({
  default: ({ readOnly, data }: any) => (
    <div
      data-custom
      data-readonly={String(readOnly)}
      data-actions={data.spec.actions.join(",")}
    />
  ),
}));
vi.mock("@/components/studio/views/WorkRecordView", () => ({
  default: ({ records, spec, onEdit, onStatusChange }: any) => (
    <div>
      {records.map((r: any) => (
        <span key={r.id}>
          {r.fields.title}
          {spec.actions.includes("record.update") && (
            <button onClick={() => onEdit(r)}>Edit</button>
          )}
          {onStatusChange && (
            <button onClick={() => onStatusChange(r, "done")}>Complete</button>
          )}
        </span>
      ))}
    </div>
  ),
}));
vi.mock("@/components/studio/views/WorkRecordEditor", () => ({
  default: ({ record }: any) => (
    <div role="dialog">{record?.fields.title ?? "New"}</div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const record = {
  id: "t-one",
  fields: { title: "Original task", status: "todo" },
  source: { revision: "rev" },
  schemaRevision: "schema",
};
const viewSpec = {
  specVersion: 1,
  collectionId: "c-one12345",
  layout: "table",
  fields: ["title", "status"],
  actions: ["record.update"],
};
const snapshot = {
  rootId: "root",
  collection: { id: "c-one12345", template: "tasks", folder: "Project" },
  records: [record],
  spec: viewSpec,
  view: { id: "v-one12345", spec: viewSpec },
  fields: { title: "text", status: "enum" },
};
const page = {
  specVersion: 1,
  title: "My page",
  layout: { columns: 1, density: "comfortable" },
  blocks: [
    { id: "tasks", kind: "tasks", title: "Tasks", viewId: "v-one12345" },
  ],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  api.request.mockReset();
  api.request.mockResolvedValue(snapshot);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(spec: any = page, preview = false) {
  await act(async () =>
    root.render(
      <PageCanvas
        rootId="root"
        sources={{ rootId: "root", collections: [], views: [] }}
        spec={spec}
        blocks={[{ blockId: "tasks", data: snapshot, limited: false } as any]}
        locale="en"
        refresh={vi.fn()}
        preview={preview}
      />,
    ),
  );
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === text)!
      .click(),
  );
}
it("rechecks a saved view before opening an editor and refuses removed actions", async () => {
  api.request.mockResolvedValue({
    ...snapshot,
    view: { ...snapshot.view, spec: { ...viewSpec, actions: [] } },
  });
  await render();
  await click("Edit");
  expect(api.request).toHaveBeenCalledWith(
    "read",
    { rootId: "root", viewId: "v-one12345" },
    expect.any(AbortSignal),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain("Available actions changed");
});
it("makes AI previews read-only for both native and custom blocks", async () => {
  await render(page, true);
  expect(host.querySelector("button")).toBeNull();
  await render(
    {
      ...page,
      blocks: [
        { id: "tasks", kind: "html", title: "Web", html: "<h1>Hi</h1>" },
      ],
    },
    true,
  );
  expect(
    host.querySelector("[data-custom]")?.getAttribute("data-readonly"),
  ).toBe("true");
  expect(
    host.querySelector("[data-custom]")?.getAttribute("data-actions"),
  ).not.toContain("record.update");
});
it("shows a failed mutation without pretending that a task was completed", async () => {
  api.request.mockImplementation((op: string) =>
    op === "mutate"
      ? Promise.reject(new Error("Revision conflict"))
      : Promise.resolve(snapshot),
  );
  await render();
  await click("Complete");
  expect(host.textContent).toContain("Original task");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Revision conflict",
  );
});
it("aborts a pending editor read when the page unmounts", async () => {
  let resolve!: (x: any) => void;
  api.request.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await click("Edit");
  const signal = api.request.mock.calls[0][2] as AbortSignal;
  await act(async () => root.render(<div>Another page</div>));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(snapshot));
  expect(host.textContent).toBe("Another page");
});
