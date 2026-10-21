import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import * as api from "./index.js";
const roots: string[] = [];
let seq = 0;
const op = () => `11111111-1111-4111-8111-${String(++seq).padStart(12, "0")}`;
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "views-service-"));
  roots.push(root);
  const Store = (api as any).WorkViewsService;
  expect(Store).toBeTypeOf("function");
  return {
    root,
    service: new Store(root, async (o: any) => {
      mkdirSync(dirname(join(root, o.path)), { recursive: true });
      writeFileSync(join(root, o.path), o.content);
    }),
  };
};
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
it("keeps task identity through two views, schema extension, editing, retry and undo", async () => {
  const { root, service: s } = setup();
  const created = await s.create({
    name: "Project",
    folder: "Projects/A",
    template: "tasks",
    mode: "new",
    operationId: op(),
  });
  const collectionId = created.collection.id;
  let snapshot = s.read(collectionId);
  const request = {
    collectionId,
    action: "record.create",
    operationId: op(),
    expectedRevision: snapshot.revision,
    expectedSchemaRevision: snapshot.schemaRevision,
    input: { title: "One", status: "todo" },
  };
  const receipt = await s.mutate(request);
  await s.mutate(request);
  snapshot = s.read(collectionId);
  expect(snapshot.records).toHaveLength(1);
  const draft = await s.preview({
    collectionId,
    spec: { ...created.view.spec, layout: "board", groupBy: "status" },
  });
  const second = await s.save({
    draftId: draft.draftId,
    name: "Board",
    operationId: op(),
  });
  expect(second.view.collectionId).toBe(collectionId);
  await s.mutate({
    collectionId,
    action: "schema.extend",
    operationId: op(),
    expectedRevision: snapshot.revision,
    expectedSchemaRevision: snapshot.schemaRevision,
    input: { key: "x_context" },
  });
  await expect(s.mutate({ ...request, operationId: op() })).rejects.toThrow();
  snapshot = s.read(collectionId);
  const changed = await s.mutate({
    collectionId,
    recordId: snapshot.records[0].id,
    action: "record.update",
    operationId: op(),
    expectedRevision: snapshot.revision,
    expectedSchemaRevision: snapshot.schemaRevision,
    input: { status: "done", x_context: "保留" },
  });
  expect(s.read(collectionId).records[0].fields.status).toBe("done");
  await s.mutate({
    collectionId,
    action: "operation.undo",
    operationId: op(),
    input: { operationId: changed.operationId },
  });
  expect(s.read(collectionId).records[0].fields.status).toBe("todo");
  await s.save({
    action: "remove",
    viewId: second.view.id,
    expectedViewVersion: second.view.version,
    operationId: op(),
  });
  expect(readFileSync(join(root, "Projects/A/TODO.csv"), "utf8")).toContain(
    "One",
  );
  expect(receipt.committed).toBe(true);
  await expect(
    s.mutate({
      collectionId,
      action: "operation.undo",
      operationId: op(),
      input: { operationId: receipt.operationId },
    }),
  ).rejects.toThrow();
});
it("preserves legacy private text and stabilizes identity on the first people update", async () => {
  const { root, service: s } = setup();
  mkdirSync(join(root, "People"));
  writeFileSync(
    join(root, "People/A.md"),
    "# Alice\n\n## 背景\nDesigner\n\n## 私人反思\nSECRET\n",
  );
  const c = await s.create({
    name: "People",
    folder: "People",
    template: "people",
    mode: "existing",
    operationId: op(),
  });
  const snap = s.read(c.collection.id),
    p = snap.records[0];
  await s.mutate({
    collectionId: c.collection.id,
    recordId: p.id,
    action: "record.update",
    operationId: op(),
    expectedRevision: p.source.revision,
    expectedSchemaRevision: snap.schemaRevision,
    input: { name: "Alice", focus: "Research" },
  });
  const raw = readFileSync(join(root, "People/A.md"), "utf8");
  expect(raw).toContain("## 私人反思\nSECRET\n");
  expect(raw).toContain("mindos-person:" + p.id);
  expect(JSON.stringify(s.read(c.collection.id))).not.toContain("SECRET");
});
it("rejects malformed sources and escaping paths without overwriting originals", async () => {
  const { root, service: s } = setup();
  mkdirSync(join(root, "Project"));
  writeFileSync(join(root, "Project/TODO.csv"), "bad,data");
  await expect(
    s.create({
      name: "Bad",
      folder: "Project",
      template: "tasks",
      mode: "existing",
      operationId: op(),
    }),
  ).rejects.toThrow();
  expect(readFileSync(join(root, "Project/TODO.csv"), "utf8")).toBe("bad,data");
  await expect(
    s.create({
      name: "Escape",
      folder: "../outside",
      template: "tasks",
      mode: "new",
      operationId: op(),
    }),
  ).rejects.toThrow();
});
it("previews an optional task field without changing the original file", async () => {
  const { root, service: s } = setup();
  const c = await s.create({
    name: "Fields",
    folder: "Fields",
    template: "tasks",
    mode: "new",
    operationId: op(),
  });
  const before = readFileSync(join(root, "Fields/TODO.csv"), "utf8");
  const preview = await s.preview({
    collectionId: c.collection.id,
    schemaExtension: { key: "x_context" },
  });
  expect(preview).toMatchObject({
    schemaChange: { key: "x_context", affectedRecords: 0 },
  });
  expect(readFileSync(join(root, "Fields/TODO.csv"), "utf8")).toBe(before);
});
it("reads 500 records after restart and rejects stale edits after external changes", async () => {
  const { root, service: s } = setup();
  const c = await s.create({
    name: "Scale",
    folder: "Scale",
    template: "tasks",
    mode: "new",
    operationId: op(),
  });
  const path = join(root, "Scale/TODO.csv");
  const csv =
    "id,title,status,dueDate,personRef,sourcePath\n" +
    Array.from(
      { length: 500 },
      (_, i) => `t-${String(i).padStart(8, "0")},Task ${i},todo,,,`,
    ).join("\n") +
    "\n";
  writeFileSync(path, csv);
  const start = performance.now();
  const snap = s.read(c.collection.id);
  expect(snap.records).toHaveLength(500);
  expect(performance.now() - start).toBeLessThan(1000);
  const restarted = new (api as any).WorkViewsService(root, s.write);
  expect(restarted.read(c.collection.id).records[499].id).toBe("t-00000499");
  writeFileSync(path, csv.replace("Task 0", "Externally changed"));
  await expect(
    restarted.mutate({
      collectionId: c.collection.id,
      recordId: "t-00000000",
      action: "record.update",
      operationId: op(),
      expectedRevision: snap.revision,
      expectedSchemaRevision: snap.schemaRevision,
      input: { title: "Stale" },
    }),
  ).rejects.toThrow();
  expect(readFileSync(path, "utf8")).toContain("Externally changed");
  writeFileSync(path, "invalid");
  expect(() => restarted.read(c.collection.id)).toThrow();
  writeFileSync(path, csv);
  expect(restarted.read(c.collection.id).records).toHaveLength(500);
});
it("replays a saved view after its preview has expired", async () => {
  const { root, service: s } = setup();
  const c = await s.create({
    name: "Retry",
    folder: "Retry",
    template: "tasks",
    mode: "new",
    operationId: op(),
  });
  const d = await s.preview({
    collectionId: c.collection.id,
    spec: c.view.spec,
  });
  const request = { draftId: d.draftId, name: "Saved", operationId: op() };
  const saved = await s.save(request);
  const path = join(root, `.mindos/views/drafts/${d.draftId}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.expiresAt = 0;
  writeFileSync(path, JSON.stringify(raw));
  expect(await s.save(request)).toEqual(saved);
  expect(s.list().views).toHaveLength(2);
});

it("describes executable interaction and follow-up inputs instead of requiring agents to guess fields", async () => {
  const { service: s } = setup();
  const { collection } = await s.create({ name: "Contacts", folder: "Contacts", template: "people", mode: "new", operationId: op() });
  const contract = s.describe(collection.id).mutationInputs;
  expect(contract["interaction.add"].required).toEqual(["text", "date"]);
  expect(contract["followup.update"].properties.completed.type).toBe("boolean");
  expect(contract["schema.extend"].example).toEqual({ key: "x_context" });
  await s.mutate({ collectionId: collection.id, action: "record.create", operationId: op(), expectedSchemaRevision: s.read(collection.id).schemaRevision, input: { name: "林悦" } });
  for (const action of ["interaction.add", "followup.update"]) {
    const snapshot = s.read(collection.id), person = snapshot.records[0];
    await s.mutate({ collectionId: collection.id, recordId: person.id, action, operationId: op(), expectedRevision: person.source.revision, expectedSchemaRevision: snapshot.schemaRevision, input: contract[action].example });
  }
  const person = s.read(collection.id).records[0];
  expect(person.fields.followup).toBe(contract["followup.update"].example.text);
  expect(person.fields.followupState).toBe("todo");
  expect(person.fields.interactionCount).toBe("1");
  expect(person.fields.lastInteraction).toBe(contract["interaction.add"].example.text);
  expect(person.fields.lastInteractionDate).toBe("2026-10-22");
  await s.mutate({ collectionId: collection.id, recordId: person.id, action: "followup.update", operationId: op(), expectedRevision: person.source.revision, expectedSchemaRevision: person.schemaRevision, input: { ...contract["followup.update"].example, completed: true } });
  expect(s.read(collection.id).records[0].fields.followupState).toBe("done");
  expect(s.describe().mutationInputs).toEqual(contract);
  expect(() => s.describe("c-missing")).toThrow();
});

it("projects empty people history without inventing an interaction", async () => {
  const { service: s } = setup();
  const { collection } = await s.create({ name: "Empty", folder: "Empty", template: "people", mode: "new", operationId: op() });
  await s.mutate({ collectionId: collection.id, action: "record.create", operationId: op(), expectedSchemaRevision: s.read(collection.id).schemaRevision, input: { name: "New" } });
  expect(s.read(collection.id).records[0].fields).toMatchObject({ followupState: "todo", interactionCount: "0", lastInteraction: "", lastInteractionDate: "" });
});
