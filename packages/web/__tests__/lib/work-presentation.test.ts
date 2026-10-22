import { expect, it } from "vitest";
import {
  filterWorkRecords,
  withHiddenCompleted,
} from "@/lib/views/work-presentation";
it("combines status and visible text without exposing hidden fields or mutating the source", () => {
  const records = [
    {
      id: "1",
      fields: { title: "计划 🌱", status: "todo", secret: "private" },
    },
    { id: "2", fields: { title: "Review", status: "done" } },
  ] as any;
  expect(filterWorkRecords(records, ["title"], "  REVIEW ")).toEqual([
    records[1],
  ]);
  expect(filterWorkRecords(records, ["title"], "🌱", "todo")).toEqual([
    records[0],
  ]);
  expect(filterWorkRecords(records, ["title"], "private")).toEqual([]);
  expect(filterWorkRecords(records, ["title"], "", "doing")).toEqual([]);
  expect(filterWorkRecords([], ["title"], "")).toEqual([]);
  expect(records).toHaveLength(2);
});
it("toggles completed tasks without discarding other Agent-defined filters", () => {
  const condition = { field: "title", op: "contains", value: "Review" };
  const spec = { filter: { all: [condition] } } as any;
  const hidden = withHiddenCompleted(spec, true);
  expect(hidden.filter!.all).toHaveLength(2);
  expect(withHiddenCompleted(hidden, true).filter!.all).toHaveLength(2);
  expect(withHiddenCompleted(hidden, false).filter!.all).toEqual([condition]);
  expect(spec.filter.all).toEqual([condition]);
});
