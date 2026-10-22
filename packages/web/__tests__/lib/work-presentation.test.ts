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

it("classifies local due dates without treating completed, empty or invalid dates as overdue", async () => {
  const { taskDueState, localCalendarDay, filterPeopleFollowups } = await import('@/lib/views/work-presentation');
  expect(localCalendarDay(new Date(2026, 9, 22, 0, 5))).toBe('2026-10-22');
  const task = (dueDate: string, status = 'todo') => ({fields:{dueDate,status}} as any);
  expect(taskDueState(task('2026-10-21'),'2026-10-22')).toBe('overdue');
  expect(taskDueState(task('2026-10-22'),'2026-10-22')).toBe('today');
  expect(taskDueState(task('2026-10-23'),'2026-10-22')).toBe('later');
  expect(taskDueState(task(''),'2026-10-22')).toBe('unscheduled');
  expect(taskDueState(task('2026-02-30'),'2026-10-22')).toBe('invalid');
  expect(taskDueState(task('2026-10-21','done'),'2026-10-22')).toBe('completed');
  const people = [{name:'叶 🌱',background:'design',focus:'',followup:{text:'发方案',completed:false}},{name:'林',background:'',focus:'',followup:{text:'已联系',completed:true}}];
  expect(filterPeopleFollowups(people, '🌱', true)).toEqual([people[0]]);
  expect(filterPeopleFollowups(people, '', true)).toHaveLength(1);
  expect(filterPeopleFollowups([], '', true)).toEqual([]);
  expect(filterPeopleFollowups(people, 'unknown', false)).toEqual([]);
});
