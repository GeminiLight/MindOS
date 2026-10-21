// Public discovery contract: agents must not infer write keys from read projections
// (for example, the read field `followup` is written through input.text).
const text = { type: "string" };
const date = { type: "string", description: "YYYY-MM-DD, or empty when unscheduled" };
const people = {
  type: "object",
  properties: { name: text, background: text, focus: text },
  additionalProperties: false,
};
const tasks = {
  type: "object",
  properties: {
    title: text,
    status: { type: "string", enum: ["todo", "doing", "done"] },
    dueDate: date,
    personRef: { type: "string", description: "collectionId/personId, e.g. c-12345678/p-12345678; empty clears the link" },
    sourcePath: { type: "string", description: "Relative knowledge-library path, or empty" },
  },
  description: "Only existing x_* optional fields from describe.fields may also be written, as strings.",
};
export const mutationInputs = {
  "record.create": {
    byTemplate: {
      people: { ...people, required: ["name"], example: { name: "林悦", background: "设计顾问", focus: "本地知识工具" } },
      tasks: { ...tasks, required: ["title"], example: { title: "完成原型评审", status: "doing", dueDate: "2026-10-24" } },
    },
    revision: "Tasks require the collection revision; new people omit expectedRevision. Both require expectedSchemaRevision.",
  },
  "record.update": {
    byTemplate: { people, tasks },
    revision: "Use the current record.source.revision and expectedSchemaRevision. Send only fields to change.",
  },
  "interaction.add": {
    type: "object", templates: ["people"], required: ["text", "date"],
    properties: { text, date, source: text }, additionalProperties: false,
    example: { text: "讨论 MindOS 视图", date: "2026-10-22", source: "验收会话" },
  },
  "followup.update": {
    type: "object", templates: ["people"], required: ["text", "date", "completed"],
    properties: { text, date, completed: { type: "boolean" } }, additionalProperties: false,
    description: "Replaces the whole follow-up; preserve text/date when marking completed. Default completed is false.",
    example: { text: "发送原型", date: "2026-10-24", completed: false },
  },
  "schema.extend": {
    type: "object", templates: ["tasks"], required: ["key"],
    properties: { key: { type: "string", pattern: "^x_[a-z][a-z0-9_]{0,39}$" } },
    example: { key: "x_context" },
  },
  "operation.undo": {
    type: "object", required: ["operationId"],
    properties: { operationId: { type: "string", description: "UUID of the original committed update to undo" } },
    description: "Use a fresh outer operationId. Creation and schema changes cannot be undone.",
  },
};
