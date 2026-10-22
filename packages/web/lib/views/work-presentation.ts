import type { WorkRecord, ViewSpec } from "@geminilight/mindos/knowledge/views";
/** Search only visible fields so hidden/private context cannot create invisible matches. */
export function filterWorkRecords(
  records: WorkRecord[],
  fields: string[],
  query: string,
  status = "all",
) {
  const text = query.trim().toLocaleLowerCase();
  return records.filter(
    (record) =>
      (status === "all" || record.fields.status === status) &&
      (!text ||
        fields.some((key) =>
          (record.fields[key] ?? "").toLocaleLowerCase().includes(text),
        )),
  );
}
export function withHiddenCompleted(spec: ViewSpec, hidden: boolean): ViewSpec {
  const all = (spec.filter?.all ?? []).filter(
    (f) => !(f.field === "status" && f.op === "neq" && f.value === "done"),
  );
  return {
    ...spec,
    filter: {
      all: hidden
        ? [...all, { field: "status", op: "neq", value: "done" }]
        : all,
    },
  };
}

export function localCalendarDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function taskDueState(record: WorkRecord, today = localCalendarDay()) {
  if (record.fields.status === "done") return "completed";
  const date = record.fields.dueDate;
  if (!date) return "unscheduled";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "invalid";
  const parsed = new Date(date + "T12:00:00Z");
  if (
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    return "invalid";
  return date < today ? "overdue" : date === today ? "today" : "later";
}
export function filterPeopleFollowups<
  T extends {
    name: string;
    background: string;
    focus: string;
    followup: { text: string; completed: boolean };
  },
>(people: T[], query: string, pending: boolean): T[] {
  const text = query.trim().toLocaleLowerCase();
  return people.filter(
    (p) =>
      (!pending || (!!p.followup.text.trim() && !p.followup.completed)) &&
      `${p.name} ${p.background} ${p.focus} ${p.followup.text}`
        .toLocaleLowerCase()
        .includes(text),
  );
}
