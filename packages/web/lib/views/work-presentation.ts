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
