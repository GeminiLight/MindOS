// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useWorkQuickActions } from "@/lib/views/use-work-quick-actions";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/views/work-api", async () => ({...await vi.importActual("@/lib/views/work-api"), workRequest: request }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("serializes writes, preserves retry identity and ignores late results after a library switch", async () => {
  request.mockReset();
  const host = document.createElement("div"),
    root = createRoot(host),
    saved = vi.fn(),
    refresh = vi.fn();
  let hook: any;
  const record = {
    id: "t",
    rootId: "a",
    fields: { title: "Task", status: "todo" },
    source: { revision: "old" },
  } as any;
  const data = {
    rootId: "a",
    collection: { id: "c", template: "tasks" },
    schemaRevision: "schema",
    revision: "old",
    view: {
      id: "v",
      spec: { fields: ["title", "status"], actions: ["record.update"] },
    },
    records: [record],
  } as any;
  function Probe({ value = data }: { value?: any }) {
    hook = useWorkQuickActions(value, refresh, saved);
    return null;
  }
  await act(async () => root.render(<Probe />));
  let reject: (e: Error) => void = () => {};
  request.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  let first: Promise<void>;
  await act(async () => {
    first = hook.changeStatus(record, "done");
    void hook.changeStatus(record, "done");
  });
  expect(request).toHaveBeenCalledTimes(1);
  const operation = request.mock.calls[0][1].operationId;
  await act(async () => {
    reject(new Error("offline"));
    await first;
  });
  expect(hook.error).toContain("offline");
  let resolve: (v: any) => void = () => {};
  request.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    first = hook.changeStatus(record, "done");
  });
  expect(request.mock.calls[1][1]).toMatchObject({
    operationId: operation,
    expectedRevision: "old",
    expectedRootId: "a",
    input: { status: "done" },
  });
  await act(async () =>
    root.render(<Probe value={{ ...data, rootId: "b" }} />),
  );
  await act(async () => {
    resolve({});
    await first;
  });
  expect(saved).not.toHaveBeenCalled();
  expect(hook.error).toBe("");
  await act(async () => root.unmount());
});
it("rejects read-only and cross-collection actions and keeps undo on the same guarded channel", async () => {
  request.mockReset().mockResolvedValue({});
  const host = document.createElement("div"),
    root = createRoot(host),
    saved = vi.fn();
  let hook: any;
  const record = {
    id: "t",
    rootId: "a",
    fields: { status: "done" },
    source: { revision: "current" },
  } as any;
  const data = {
    rootId: "a",
    collection: { id: "c", template: "tasks" },
    schemaRevision: "s",
    view: { id: "v", spec: { fields: ["status"], actions: [] } },
    records: [record],
  } as any;
  function Probe({ value = data }: { value?: any }) {
    hook = useWorkQuickActions(value, vi.fn(), saved);
    return null;
  }
  await act(async () => root.render(<Probe />));
  await act(async () => hook.changeStatus(record, "todo"));
  expect(request).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      <Probe
        value={{
          ...data,
          view: {
            ...data.view,
            spec: { fields: ["status"], actions: ["record.update"] },
          },
        }}
      />,
    ),
  );
  await act(async () =>
    hook.changeStatus({ ...record, id: "foreign" }, "todo"),
  );
  expect(request).not.toHaveBeenCalled();
  await act(async () => hook.changeStatus(record, "todo"));
  expect(saved).toHaveBeenCalledWith(expect.any(String), "todo");
  await act(async () => hook.undo("previous-operation"));
  expect(request.mock.calls.at(-1)![1]).toMatchObject({
    action: "operation.undo",
    expectedRootId: "a",
    collectionId: "c",
    input: { operationId: "previous-operation" },
  });
  expect(saved).toHaveBeenLastCalledWith(undefined, "undo");
  await act(async () => root.unmount());
});
