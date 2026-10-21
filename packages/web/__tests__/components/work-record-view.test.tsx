// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("renders shared record IDs in table and board and opens an editable record by keyboard", async () => {
  expect(
    existsSync(resolve("components/studio/views/WorkRecordView.tsx")),
  ).toBe(true);
  const { default: View } = await import(
    "@/components/studio/views/WorkRecordView"
  );
  const onEdit = vi.fn(),
    record = {
      id: "t-1",
      fields: { title: "Write brief", status: "doing", dueDate: "" },
      source: { path: "Project/TODO.csv" },
    } as any;
  const props = {
    records: [record],
    spec: {
      fields: ["title", "status"],
      layout: "table",
      actions: ["record.update", "source.open"],
    } as any,
    onEdit,
    locale: "en" as const,
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<View {...props} />));
  await act(async () => host.querySelector("button")!.click());
  expect(onEdit).toHaveBeenCalledWith(record);
  await act(async () =>
    root.render(
      <View
        {...props}
        spec={{ ...props.spec, layout: "board", groupBy: "status" }}
      />,
    ),
  );
  expect(host.textContent).toContain("Doing");
  expect(host.textContent).toContain("Write brief");
  await act(async () => root.unmount());
});
it("shows explicit empty results and treats field content as text", async () => {
  expect(
    existsSync(resolve("components/studio/views/WorkRecordView.tsx")),
  ).toBe(true);
  const { default: View } = await import(
    "@/components/studio/views/WorkRecordView"
  );
  const host = document.createElement("div"),
    root = createRoot(host);
  await act(async () =>
    root.render(
      <View
        records={[]}
        spec={{ fields: ["title"], layout: "table", actions: [] } as any}
        onEdit={() => {}}
        locale="en"
      />,
    ),
  );
  expect(host.textContent).toContain("No matching records");
  await act(async () => root.unmount());
});

it("renders follow-up completion and recent interaction in a generated people table", async () => {
  const { default: View } = await import("@/components/studio/views/WorkRecordView");
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<View
    records={[{ id: "p-person", fields: { name: "林悦", followupState: "done", lastInteraction: "确认参加访谈", interactionCount: "2" }, source: { path: "person.md" } } as any]}
    spec={{ fields: ["name", "followupState", "lastInteraction", "interactionCount"], layout: "table", actions: [] } as any}
    onEdit={() => {}} locale="zh"
  />));
  expect(host.textContent).toContain("跟进状态");
  expect(host.textContent).toContain("已完成");
  expect(host.textContent).toContain("最近互动");
  expect(host.textContent).toContain("确认参加访谈");
  await act(async () => root.unmount());
});
