import Papa from "papaparse";
import { documentRevision } from "./markdown.js";
import { ViewError } from "./types.js";
export const TASK_HEADERS = [
  "id",
  "title",
  "status",
  "dueDate",
  "personRef",
  "sourcePath",
];
export type TaskTable = {
  headers: string[];
  rows: Record<string, string>[];
  schemaRevision: string;
};
export const optionalTaskField = (key: string) =>
  /^x_[a-z][a-z0-9_]{0,39}$/.test(key);
function invalid(message: string): never {
  throw new ViewError("READ_ONLY_FORMAT", message, 422);
}
export function validDate(value: string): boolean {
  return (
    !value ||
    (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value)
  );
}
export function parseTasks(raw: string): TaskTable {
  if (Buffer.byteLength(raw) > 256 * 1024) invalid("Task file exceeds 256 KiB");
  const result = Papa.parse<string[]>(raw.replace(/^\ufeff/, ""), {
    skipEmptyLines: true,
  });
  if (result.errors.length)
    invalid("CSV is malformed: " + result.errors[0]!.message);
  const [headers, ...values] = result.data;
  if (
    !headers ||
    TASK_HEADERS.some((h) => !headers.includes(h)) ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) =>
        !h ||
        h.length > 80 ||
        ["__proto__", "constructor", "prototype"].includes(h),
    )
  )
    invalid("Task headers are missing, duplicated or unsafe");
  if (
    headers.filter(optionalTaskField).length > 10 ||
    headers.length > 64 ||
    values.length > 500
  )
    invalid("Task collection exceeds its field or record limit");
  const seen = new Set<string>();
  const rows = values.map((values) => {
    if (values.length !== headers.length)
      invalid("CSV row has a different number of cells");
    const row = Object.fromEntries(
      headers.map((h, i) => [h, values[i]!]),
    ) as Record<string, string> & {
      id: string;
      title: string;
      status: string;
      dueDate: string;
      personRef: string;
      sourcePath: string;
    };
    if (!/^t-[a-zA-Z0-9-]{8,80}$/.test(row.id) || seen.has(row.id))
      invalid("Task IDs must be stable and unique");
    seen.add(row.id);
    if (
      !row.title.trim() ||
      row.title.length > 200 ||
      !["todo", "doing", "done"].includes(row.status)
    )
      invalid("Task title or status is invalid");
    if (!validDate(row.dueDate))
      invalid("Task date must be a calendar date (YYYY-MM-DD)");
    if (
      row.personRef &&
      !/^c-[a-z0-9-]{8,80}\/p-[a-z0-9-]{8,80}$/.test(row.personRef)
    )
      invalid("Person reference must identify a collection and person");
    if (
      row.sourcePath &&
      (/^(\/|[a-z]:|[a-z]+:)/i.test(row.sourcePath) ||
        row.sourcePath
          .split(/[\\/]/)
          .some((x) => !x || x === ".." || x.startsWith(".")))
    )
      invalid("Source must be a relative library path");
    if (headers.some((h) => optionalTaskField(h) && row[h]!.length > 1000))
      invalid("Optional text exceeds 1000 characters");
    return row;
  });
  return {
    headers,
    rows,
    schemaRevision: documentRevision(
      JSON.stringify(["tasks@1", ...headers.filter(optionalTaskField)]),
    ),
  };
}
export function serializeTasks(
  table: Pick<TaskTable, "headers" | "rows">,
): string {
  const raw =
    Papa.unparse(
      {
        fields: table.headers,
        data: table.rows.map((r) => table.headers.map((h) => r[h] ?? "")),
      },
      { newline: "\n" },
    ) + "\n";
  parseTasks(raw);
  return raw;
}
export function extendTaskSchema(raw: string, key: string): string {
  const table = parseTasks(raw);
  if (!optionalTaskField(key) || table.headers.includes(key))
    throw new ViewError(
      "INVALID_RECORD",
      "Choose a new optional x_* text field",
    );
  table.headers.push(key);
  return serializeTasks(table);
}
