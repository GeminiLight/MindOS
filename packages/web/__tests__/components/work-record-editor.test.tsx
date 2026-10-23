// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Editor from "@/components/studio/views/WorkRecordEditor";
import { readViewDraft } from "@/lib/views/drafts";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/views/work-api", async () => ({...await vi.importActual("@/lib/views/work-api"), workRequest: api.request }));
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

it("prefills a person only for its own creation context and keeps generic drafts separate", async () => {
  const render = async (personRef: string) =>
    act(async () =>
      root.render(
        <Editor
          key={personRef}
          data={data}
          initialPersonRef={personRef}
          locale="en"
          close={vi.fn()}
          saved={vi.fn()}
        />,
      ),
    );
  await render("people/one");
  await change(host.querySelector('input[name="title"]')!, "For one");
  await render("people/two");
  expect(
    host.querySelector<HTMLInputElement>('input[name="title"]')!.value,
  ).toBe("");
  await change(host.querySelector('input[name="title"]')!, "For two");
  await submit();
  expect(api.request).toHaveBeenLastCalledWith(
    "mutate",
    expect.objectContaining({
      input: expect.objectContaining({
        title: "For two",
        personRef: "people/two",
      }),
    }),
  );
  await render("people/one");
  expect(
    host.querySelector<HTMLInputElement>('input[name="title"]')!.value,
  ).toBe("For one");
  await render("");
  expect(
    host.querySelector<HTMLInputElement>('input[name="title"]')!.value,
  ).toBe("");
});

it('blocks synchronous duplicate submissions, announces saving and allows retry after failure', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise((_, fail) => { reject = fail; });
  const close = vi.fn(), saved = vi.fn();
  await act(async () => root.render(<Editor data={data} record={record} locale="en" close={close} saved={saved} />));
  api.request.mockReturnValueOnce(pending);
  await act(async () => {
    const form = host.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(api.request.mock.calls.filter(([op]) => op === 'mutate')).toHaveLength(1);
  expect(host.querySelector('form')!.getAttribute('aria-busy')).toBe('true');
  expect(host.querySelector('[role=status]')?.textContent).toContain('Saving');
  await act(async () => { reject(new Error('Offline')); });
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Offline');
  expect(close).not.toHaveBeenCalled();
  await submit();
  expect(saved).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
it('identifies invalid required fields and clears validation once corrected', async () => {
  await act(async () => root.render(<Editor data={data} record={record} locale="en" close={vi.fn()} saved={vi.fn()} />));
  const input = host.querySelector<HTMLInputElement>('input[name=title]')!;
  await change(input, '   ');
  await submit();
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('task title');
  await change(input, 'Fixed');
  expect(input.getAttribute('aria-invalid')).not.toBe('true');
});
it('ignores a late save after the library changes and prevents further writes', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(done => { resolve = done; });
  const close = vi.fn(), saved = vi.fn();
  await act(async () => root.render(<Editor data={data} record={record} locale="en" close={close} saved={saved} />));
  await change(host.querySelector('input[name=title]')!, 'Keep in original library');
  api.request.mockReturnValueOnce(pending);
  await submit();
  await act(async () => root.render(<Editor data={{...data, rootId:'other'}} record={record} locale="en" close={close} saved={saved} />));
  await act(async () => resolve({}));
  expect(saved).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Library changed');
  expect(readViewDraft({rootId:'root', viewId:'tasks',personId:'t1',kind:'work-record'})?.values.title).toBe('Keep in original library');
  await submit();
  expect(api.request.mock.calls.filter(([op]) => op === 'mutate')).toHaveLength(1);
});
