import { describe, expect, it } from "vitest";
import * as views from "./index.js";
const api = views as unknown as {
  parseTasks: (s: string) => {
    headers: string[];
    rows: Record<string, string>[];
    schemaRevision: string;
  };
  serializeTasks: (t: unknown) => string;
  extendTaskSchema: (s: string, key: string) => string;
};
const header = "id,title,status,dueDate,personRef,sourcePath";
describe("task files are portable shared records", () => {
  it("reads quoted multiline Unicode and preserves unknown cells through a round trip", () => {
    expect(api.parseTasks).toBeTypeOf("function");
    const raw =
      "\ufeff" +
      header +
      ',legacy\r\nt-12345678,"你好, \"\"世界\"\"\nnext",todo,2026-10-22,,,KEEP\r\n';
    const parsed = api.parseTasks(raw);
    expect(parsed.rows[0]).toMatchObject({
      title: '你好, "世界"\nnext',
      legacy: "KEEP",
    });
    expect(api.parseTasks(api.serializeTasks(parsed))).toEqual(parsed);
  });
  it("adds only optional text columns without changing existing values or IDs", () => {
    expect(api.extendTaskSchema).toBeTypeOf("function");
    const raw = header + "\nt-12345678,First,doing,,,\n";
    const before = api.parseTasks(raw),
      after = api.parseTasks(api.extendTaskSchema(raw, "x_context"));
    expect(after.rows[0]).toEqual({ ...before.rows[0], x_context: "" });
    expect(after.schemaRevision).not.toBe(before.schemaRevision);
  });
  it("accepts an empty collection but rejects corrupt, duplicate, oversized or invalid records", () => {
    expect(api.parseTasks).toBeTypeOf("function");
    expect(api.parseTasks(header + "\n").rows).toEqual([]);
    for (const raw of [
      header + "\nt-12345678,A,bogus,,,",
      header + "\nt-12345678,A,todo,2026-02-30,,",
      header + "\nt-12345678,A,todo,,,\nt-12345678,B,todo,,,",
      header + ",title\n",
      header + '\nt-12345678,"broken,todo,,,',
      header +
        "\n" +
        Array.from(
          { length: 501 },
          (_, i) => `t-${String(i).padStart(8, "0")},A,todo,,,`,
        ).join("\n"),
    ])
      expect(() => api.parseTasks(raw)).toThrow();
    expect(() => api.extendTaskSchema(header + "\n", "status")).toThrow();
  });
});
