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
  const { default: View } = await import(
    "@/components/studio/views/WorkRecordView"
  );
  const host = document.createElement("div"),
    root = createRoot(host);
  await act(async () =>
    root.render(
      <View
        records={[
          {
            id: "p-person",
            fields: {
              name: "林悦",
              followupState: "done",
              lastInteraction: "确认参加访谈",
              interactionCount: "2",
            },
            source: { path: "person.md" },
          } as any,
        ]}
        spec={
          {
            fields: [
              "name",
              "followupState",
              "lastInteraction",
              "interactionCount",
            ],
            layout: "table",
            actions: [],
          } as any
        }
        onEdit={() => {}}
        locale="zh"
      />,
    ),
  );
  expect(host.textContent).toContain("跟进状态");
  expect(host.textContent).toContain("已完成");
  expect(host.textContent).toContain("最近互动");
  expect(host.textContent).toContain("确认参加访谈");
  await act(async () => root.unmount());
});

it("keeps board cards focused, names empty lanes and omits unauthorized source columns", async () => {
  const { default: View } = await import(
    "@/components/studio/views/WorkRecordView"
  );
  const host = document.createElement("div"),
    root = createRoot(host);
  const props = {
    records: [
      {
        id: "t1",
        fields: { title: "Plan", status: "todo", dueDate: "", x_notes: "" },
        source: { path: "Tasks.csv" },
      } as any,
    ],
    spec: {
      fields: ["title", "status", "dueDate", "x_notes"],
      layout: "board",
      actions: ["record.update"],
    } as any,
    onEdit: vi.fn(),
    locale: "en",
  };
  await act(async () => root.render(<View {...props} />));
  expect(host.querySelector("article")!.textContent).not.toContain("Status");
  expect(host.querySelector("article")!.textContent).not.toContain("Due date");
  expect(host.textContent).toContain("No tasks yet");
  await act(async () =>
    root.render(<View {...props} spec={{ ...props.spec, layout: "table" }} />),
  );
  expect(
    [...host.querySelectorAll("th")].map((n) => n.textContent),
  ).not.toContain("Source");
  expect(host.querySelector('[role="region"][tabindex="0"]')).not.toBeNull();
  await act(async () => root.unmount());
});

it("keeps the edit action on the record name when a date is the first visible column", async () => {
  const { default: View } = await import(
    "@/components/studio/views/WorkRecordView"
  );
  const host = document.createElement("div"),
    root = createRoot(host),
    onEdit = vi.fn();
  const record = {
    id: "t1",
    fields: { title: "Review", dueDate: "2026-10-22" },
    source: { path: "Tasks.csv" },
  } as any;
  await act(async () =>
    root.render(
      <View
        records={[record]}
        spec={
          {
            fields: ["dueDate", "title"],
            layout: "table",
            actions: ["record.update"],
          } as any
        }
        onEdit={onEdit}
        locale="en"
      />,
    ),
  );
  expect(host.querySelector("button")!.textContent).toBe("Review");
  await act(async () => host.querySelector("button")!.click());
  expect(onEdit).toHaveBeenCalledWith(record);
  await act(async () => root.unmount());
});

it('offers completion only for editable task views and keeps pending controls disabled', async () => {
  const { default: View } = await import('@/components/studio/views/WorkRecordView');
  const host=document.createElement('div'), root=createRoot(host), change=vi.fn();
  const record={id:'t1',fields:{title:'Review',status:'todo',dueDate:'2026-10-21'},source:{path:'TODO.csv'}} as any;
  const props={records:[record],spec:{fields:['title','status','dueDate'],layout:'board',actions:['record.update']} as any,locale:'en',onEdit:vi.fn(),onStatusChange:change,today:'2026-10-22'};
  await act(async()=>root.render(<View {...props}/>));
  expect(host.textContent).toContain('Overdue');
  const toggle=host.querySelector('button[role="checkbox"]') as HTMLButtonElement;
  expect(toggle).not.toBeNull();
  await act(async()=>toggle.click());
  expect(change).toHaveBeenCalledWith(record,'done');
  await act(async()=>root.render(<View {...props} statusBusy/>));
  expect((host.querySelector('button[role="checkbox"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>root.render(<View {...props} spec={{...props.spec,actions:[]}}/>));
  expect(host.querySelector('button[role="checkbox"]')).toBeNull();
  await act(async()=>root.render(<View {...props} spec={{...props.spec,fields:['title']}}/>));
  expect(host.querySelector('button[role="checkbox"]')).toBeNull();
  await act(async()=>root.unmount());
});

it("shows the resolved person name and explains broken references without exposing internal IDs", async () => {
  const { default: View } =
    await import("@/components/studio/views/WorkRecordView");
  const host = document.createElement("div"),
    root = createRoot(host);
  const record = {
    id: "t",
    fields: { title: "Task", personRef: "c-secret/p-secret" },
    personName: "林悦",
    personHref: "/studio/views/v-person?person=p",
    source: { path: "Tasks/TODO.csv" },
  } as any;
  const spec = {
    fields: ["title", "personRef"],
    layout: "table",
    actions: [],
  } as any;
  await act(async () =>
    root.render(
      <View records={[record]} spec={spec} onEdit={() => {}} locale="zh" />,
    ),
  );
  expect(host.textContent).toContain("林悦");
  expect(host.textContent).not.toContain("c-secret");
  await act(async () =>
    root.render(
      <View
        records={[
          { ...record, personName: undefined, personHref: undefined },
        ]}
        spec={spec}
        onEdit={() => {}}
        locale="zh"
      />,
    ),
  );
  expect(host.textContent).toContain("关联人物暂不可用");
  expect(host.textContent).not.toContain("c-secret");
  await act(async () => root.unmount());
});
