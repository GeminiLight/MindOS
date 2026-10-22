// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Designer from "@/components/studio/views/WorkViewDesigner";
const api = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/views/work-api", () => ({ workRequest: api.request }));
vi.mock("@/hooks/useSmoothRouterPush", () => ({
  useSmoothRouterPush: () => api.push,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("previews actual records in the dialog and invalidates the save candidate when the layout changes", async () => {
  const spec = {
    fields: ["title", "status"],
    layout: "table",
    actions: ["record.update"],
    collectionId: "c",
    version: 1,
  };
  const data = {
    rootId: "root",
    collection: { id: "c", template: "tasks" },
    view: { id: "v", name: "Project", version: 1, spec },
    fields: { title: "text", status: "enum" },
    records: [],
  } as any;
  api.request.mockImplementation(async (op, input) =>
    input.draftId
      ? {
          ...data,
          spec,
          records: [
            {
              id: "t",
              fields: { title: "Preview record", status: "todo" },
              source: { path: "Tasks.csv" },
            },
          ],
        }
      : { draftId: "d", previewUrl: "/preview/d" },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async (text: string) =>
    act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === text)!
        .click();
    });
  await act(async () =>
    root.render(<Designer data={data} locale="en" refresh={vi.fn()} />),
  );
  await click("Customize view");
  await click("Preview");
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain(
    "Preview record",
  );
  expect(host.querySelector('[role="dialog"] button')!.textContent).not.toBe(
    "Preview record",
  );
  await act(async () => {
    const radio = host.querySelector(
      'input[value="board"]',
    ) as HTMLInputElement;
    radio.click();
  });
  expect(host.textContent).not.toContain("Preview record");
  expect(
    [...host.querySelectorAll("button")].some(
      (b) => b.textContent === "Save this view",
    ),
  ).toBe(false);
  await act(async () => root.unmount());
  host.remove();
});
