import { expect, it } from "vitest";
import * as views from "./index.js";
const api = views as unknown as {
  validateViewSpec: (s: unknown, fields: Record<string, string>) => any;
  projectView: (s: any, rows: any[]) => any[];
};
const fields = { title: "text", status: "enum", dueDate: "date" };
const spec = {
  specVersion: 1,
  collectionId: "c-12345678",
  layout: "board",
  fields: ["title", "dueDate"],
  groupBy: "status",
  sort: [{ field: "dueDate", direction: "asc" }],
  filter: { all: [{ field: "status", op: "neq", value: "done" }] },
  actions: ["record.update", "source.open"],
};
it("validates and applies a bounded view with missing dates last and stable ties", () => {
  expect(api.validateViewSpec).toBeTypeOf("function");
  const checked = api.validateViewSpec(spec, fields);
  expect(
    api
      .projectView(checked, [
        { id: "3", fields: { title: "C", status: "todo", dueDate: "" } },
        {
          id: "2",
          fields: { title: "B", status: "todo", dueDate: "2026-10-22" },
        },
        {
          id: "1",
          fields: { title: "A", status: "done", dueDate: "2026-10-20" },
        },
      ])
      .map((x) => x.id),
  ).toEqual(["2", "3"]);
});
it("rejects code, unknown fields, unregistered actions and unsupported grouping", () => {
  expect(api.validateViewSpec).toBeTypeOf("function");
  for (const value of [
    { ...spec, script: "alert(1)" },
    { ...spec, fields: ["private"] },
    { ...spec, actions: ["shell.exec"] },
    { ...spec, groupBy: "title" },
    { ...spec, sort: Array(3).fill({ field: "title", direction: "asc" }) },
    {
      ...spec,
      filter: { all: [{ field: "dueDate", op: "contains", value: "a" }] },
    },
  ])
    expect(() => api.validateViewSpec(value, fields)).toThrow();
});
it("rejects impossible date filter values and task-only actions on the wrong template", () => {
  expect(() =>
    api.validateViewSpec(
      {
        ...spec,
        filter: {
          all: [{ field: "dueDate", op: "after", value: "2026-99-99" }],
        },
      },
      fields,
    ),
  ).toThrow();
  expect(() =>
    api.validateViewSpec({ ...spec, actions: ["interaction.add"] }, fields),
  ).toThrow();
});
