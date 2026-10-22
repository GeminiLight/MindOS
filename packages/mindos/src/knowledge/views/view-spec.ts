import { validDate } from "./tasks-csv.js";
import { z } from "zod";
import { ViewError } from "./types.js";
const field = z.string().min(1).max(80);
export const viewSpecSchema = z.strictObject({
  specVersion: z.literal(1),
  collectionId: z.string().regex(/^c-[a-z0-9-]{8,80}$/),
  layout: z.enum(["list-detail", "table", "board"]),
  page: z
    .strictObject({
      description: z.string().max(280).optional(),
      showSummary: z.boolean().optional(),
    })
    .optional(),
  fields: z.array(field).min(1).max(20),
  groupBy: field.optional(),
  sort: z
    .array(z.strictObject({ field, direction: z.enum(["asc", "desc"]) }))
    .max(2)
    .optional(),
  filter: z
    .strictObject({
      all: z
        .array(
          z.strictObject({
            field,
            op: z.enum(["eq", "neq", "contains", "before", "after", "isEmpty"]),
            value: z.string().max(1000).optional(),
          }),
        )
        .max(10),
    })
    .optional(),
  labels: z.record(field, z.string().min(1).max(80)).optional(),
  actions: z
    .array(
      z.enum([
        "record.create",
        "record.update",
        "interaction.add",
        "followup.update",
        "source.open",
      ]),
    )
    .max(5),
});
export type ViewSpec = z.infer<typeof viewSpecSchema>;
export type FieldTypes = Record<string, "text" | "enum" | "date">;
export function validateViewSpec(input: unknown, fields: FieldTypes): ViewSpec {
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 32768)
    throw new ViewError("INVALID_VIEW", "View exceeds 32 KiB");
  const result = viewSpecSchema.safeParse(input);
  if (!result.success)
    throw new ViewError(
      "INVALID_VIEW",
      result.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; "),
    );
  const s = result.data;
  const keys = [
    ...s.fields,
    ...(s.sort ?? []).map((x) => x.field),
    ...(s.filter?.all ?? []).map((x) => x.field),
    ...Object.keys(s.labels ?? {}),
  ];
  if (
    keys.some((k) => !Object.hasOwn(fields, k)) ||
    new Set(s.fields).size !== s.fields.length
  )
    throw new ViewError("INVALID_VIEW", "Unknown or duplicated fields");
  if (s.layout === "board" && (!s.groupBy || fields[s.groupBy] !== "enum"))
    throw new ViewError("INVALID_VIEW", "Board requires an enumerated field");
  if (s.groupBy && (s.layout !== "board" || fields[s.groupBy] !== "enum"))
    throw new ViewError("INVALID_VIEW", "Unsupported grouping");
  if (
    !Object.hasOwn(fields, "name") &&
    s.actions.some((a) => ["interaction.add", "followup.update"].includes(a))
  )
    throw new ViewError(
      "INVALID_VIEW",
      "Action is not supported by this template",
    );
  for (const f of s.filter?.all ?? []) {
    if (
      fields[f.field] === "date" &&
      f.op !== "isEmpty" &&
      (!f.value || !validDate(f.value))
    )
      throw new ViewError("INVALID_VIEW", "Invalid calendar date filter");
    const allowed =
      fields[f.field] === "date"
        ? ["before", "after", "isEmpty", "eq", "neq"]
        : fields[f.field] === "enum"
          ? ["eq", "neq"]
          : ["eq", "neq", "contains", "isEmpty"];
    if (
      !allowed.includes(f.op) ||
      (f.op !== "isEmpty" && f.value === undefined)
    )
      throw new ViewError("INVALID_VIEW", "Unsupported filter for " + f.field);
  }
  return s;
}
export function projectView<
  T extends { id: string; fields: Record<string, string> },
>(spec: ViewSpec, rows: T[]): T[] {
  return rows
    .filter((r) =>
      (spec.filter?.all ?? []).every((f) => {
        const v = r.fields[f.field] ?? "",
          expected = f.value ?? "";
        switch (f.op) {
          case "eq":
            return v === expected;
          case "neq":
            return v !== expected;
          case "contains":
            return v.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
          case "before":
            return !!v && v < expected;
          case "after":
            return !!v && v > expected;
          case "isEmpty":
            return !v;
        }
      }),
    )
    .sort((a, b) => {
      for (const s of spec.sort ?? []) {
        const x = a.fields[s.field] ?? "",
          y = b.fields[s.field] ?? "";
        if (!x !== !y) return x ? -1 : 1;
        const cmp = x.localeCompare(y);
        if (cmp) return s.direction === "asc" ? cmp : -cmp;
      }
      return a.id.localeCompare(b.id);
    });
}
export const PEOPLE_FIELDS: FieldTypes = {
  name: "text",
  background: "text",
  focus: "text",
  followup: "text",
  followupDate: "date",
  followupState: "text",
  interactionCount: "text",
  lastInteraction: "text",
  lastInteractionDate: "date",
};
export const TASK_FIELDS: FieldTypes = {
  title: "text",
  status: "enum",
  dueDate: "date",
  personRef: "text",
  sourcePath: "text",
};
export function defaultSpec(
  collectionId: string,
  template: "people" | "tasks",
): ViewSpec {
  return {
    specVersion: 1,
    collectionId,
    layout: template === "people" ? "list-detail" : "table",
    fields:
      template === "people"
        ? ["name", "background", "focus"]
        : ["title", "status", "dueDate"],
    actions: [
      "record.create",
      "record.update",
      "source.open",
      ...(template === "people"
        ? (["interaction.add", "followup.update"] as const)
        : []),
    ],
  };
}
