import { taskPeople, relatedWork } from "./relationships.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mutationInputs } from "./mutation-contract.js";
import {
  ViewError,
  type CollectionDefinition,
  type ViewDefinition,
  type ViewKnowledgeWriter,
} from "./types.js";
import { readRegistry, withRegistry } from "./registry.js";
import { checkedPath, readDocument, safeFolder, scanFolder } from "./paths.js";
import {
  documentRevision,
  validateText,
  validateId,
  validateOperationId,
  newPerson,
  patchFields,
  patchFollowup,
  appendInteraction,
  parsePerson,
} from "./markdown.js";
import {
  TASK_HEADERS,
  parseTasks,
  serializeTasks,
  extendTaskSchema,
  optionalTaskField,
} from "./tasks-csv.js";
import {
  defaultSpec,
  PEOPLE_FIELDS,
  TASK_FIELDS,
  validateViewSpec,
  projectView,
  type FieldTypes,
} from "./view-spec.js";
import {
  atomicMetadata,
  commitViewMutation,
  readReceipt,
} from "./operations.js";
import { withFileMutation } from "./file-lock.js";
import {
  findProject,
  readProjects,
  assertProjectPath,
  PROJECTS_PATH,
  type WorkProject,
} from "./project-store.js";
import {
  saveWorkView,
  previewWorkView,
  readWorkPreview,
} from "./view-drafts.js";
export type WorkRecord = {
  rootId: string;
  collectionId: string;
  id: string;
  personHref?: string;
  personName?: string;
  schemaId: string;
  schemaRevision: string;
  source: { path: string; revision: string };
  fields: Record<string, string>;
};
export type WorkSnapshot = {
  projectScope?: { id: string; version: number };
  rootId: string;
  collection: CollectionDefinition;
  schemaRevision: string;
  revision?: string;
  fields: FieldTypes;
  records: WorkRecord[];
  limited: boolean;
  skipped: number;
};
export function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ViewError("INVALID_RECORD", "Expected an object");
  return value as Record<string, unknown>;
}
export class WorkViewsService {
  readonly rootId: string;
  constructor(
    readonly root: string,
    readonly write: ViewKnowledgeWriter,
  ) {
    this.rootId = documentRevision(resolve(root)).slice(0, 24);
  }
  list() {
    const r = readRegistry(this.root);
    return {
      rootId: this.rootId,
      collections: r.collections,
      views: [...r.views]
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
        .map((v) => ({
          ...v,
          spec: v.spec ?? defaultSpec(v.collectionId!, v.template),
        })),
      registryRevision: documentRevision(JSON.stringify(r)),
    };
  }
  collection(id: string) {
    validateId(id);
    const c = readRegistry(this.root).collections.find((c) => c.id === id);
    if (!c)
      throw new ViewError(
        "COLLECTION_MISSING",
        "Collection no longer exists",
        404,
      );
    return c;
  }
  describe(id?: string) {
    return {
      capabilityVersion: 1,
      projects: {
        operations: [
          "project.list",
          "project.read",
          "project.save",
          "project.page",
          "project.interact",
        ],
        schema: "{id,title,goal,taskCollectionIds:[],personRefs:[]}",
        workflow:
          "Read project version, explicitly link existing sources, save with expectedRootId/expectedVersion/operationId. Each task collection has one project owner. project.page opens the same stable work page; project.interact writes to the linked person original Markdown with projectId. Never infer relationships from names.",
      },
      pages: {
        specVersion: 1,
        operations: [
          "page.list",
          "page.read",
          "page.data",
          "page.preview",
          "page.save",
          "page.restore",
          "page.remove",
          "page.generate",
        ],
        blocks: ["tasks", "people", "notes", "summary", "html"],
        schema:
          "{specVersion:1,title,description?,layout:{columns:1|2,density:comfortable|compact},blocks:[{id,title,kind,collectionId?,viewId?,fields?,filter?,html?,folder?,paths?,limit?,locked?,layout?}]}",
        workflow:
          "Preview without saving; save with expectedVersion 0 for new pages or the current version for edits. Pages combine existing sources. Restoring layout never restores source data.",
        customWeb:
          "Static HTML/CSS or isolated script type=mindos/page. Worker globals data,state,event,render(html,nextState?). No network or DOM. Ordinary scripts are blocked. task.complete and source.open use data-mindos-action and data-record-id; the host validates each action.",
        limits: {
          blocks: 12,
          specBytes: 131072,
          htmlCharacters: 98304,
          history: 20,
        },
      },
      mutationInputs,
      rootId: this.rootId,
      templates: [
        { id: "people", schemaId: "people@1", fields: PEOPLE_FIELDS },
        {
          id: "tasks",
          schemaId: "tasks@1",
          fields: TASK_FIELDS,
          statuses: ["todo", "doing", "done"],
        },
      ],
      layouts: ["list-detail", "table", "board"],
      presentation: {
        page: {
          description: "Optional plain text, up to 280 characters",
          showSummary: "Optional boolean; defaults to true",
        },
        navigation:
          "One workspace per collection; saved views are alternatives inside it. Binding the same existing folder reuses its workspace.",
      },
      actions: [
        "record.create",
        "record.update",
        "interaction.add",
        "followup.update",
        "schema.extend",
        "operation.undo",
      ],
      limits: {
        records: 500,
        documentBytes: 262144,
        viewBytes: 32768,
        optionalFields: 10,
      },
      ...(id
        ? {
            collection: this.collection(id),
            fields: this.read(id).fields,
            schemaRevision: this.read(id).schemaRevision,
          }
        : {}),
    };
  }
  related(collectionId: string, personId: string) {
    let projects: WorkProject[] = [],
      unavailable = false;
    try {
      projects = readProjects(this.root).projects;
    } catch {
      unavailable = true;
    }
    const result = relatedWork(
      this.rootId,
      readRegistry(this.root),
      (id) => this.read(id, false),
      collectionId,
      personId,
      projects,
    );
    result.incomplete ||= unavailable;
    return result;
  }
  read(id: string, resolvePeople = true): WorkSnapshot {
    const collection = this.collection(id),
      base = { rootId: this.rootId, collection };
    if (collection.template === "tasks") {
      const path = collection.folder + "/TODO.csv",
        raw = readDocument(this.root, path),
        table = parseTasks(raw),
        revision = documentRevision(raw);
      const people = resolvePeople
        ? taskPeople(
            this.root,
            readRegistry(this.root),
            table.rows.map((row) => row.personRef ?? ""),
          )
        : new Map();
      const fields: FieldTypes = {
        ...TASK_FIELDS,
        ...Object.fromEntries(
          table.headers
            .filter(optionalTaskField)
            .map((k) => [k, "text" as const]),
        ),
      };
      return {
        ...base,
        fields,
        revision,
        schemaRevision: table.schemaRevision,
        records: table.rows.map((row) => ({
          rootId: this.rootId,
          collectionId: id,
          id: row.id!,
          ...people.get(row.personRef ?? ""),
          schemaId: "tasks@1",
          schemaRevision: table.schemaRevision,
          source: { path, revision },
          fields: Object.fromEntries(
            Object.keys(fields).map((k) => [k, row[k] ?? ""]),
          ),
        })),
        limited: false,
        skipped: 0,
      };
    }
    const data = scanFolder(this.root, collection.folder),
      schemaRevision = documentRevision(JSON.stringify(PEOPLE_FIELDS));
    return {
      ...base,
      fields: PEOPLE_FIELDS,
      schemaRevision,
      limited: data.limited,
      skipped: data.skipped,
      records: data.people.map((p) => ({
        rootId: this.rootId,
        collectionId: id,
        id: p.id,
        schemaId: "people@1",
        schemaRevision,
        source: { path: p.path, revision: p.revision },
        fields: {
          name: p.name,
          background: p.background,
          focus: p.focus,
          followup: p.followup.text,
          followupDate: p.followup.date,
          followupState: p.followup.completed ? "done" : "todo",
          interactionCount: String(p.interactions.length),
          lastInteraction: p.interactions[0]?.text ?? "",
          lastInteractionDate: p.interactions[0]?.date ?? "",
        },
      })),
    };
  }
  view(id: string) {
    const view = this.list().views.find((v) => v.id === id);
    if (!view)
      throw new ViewError("VIEW_MISSING", "View no longer exists", 404);
    const snapshot = this.read(view.collectionId!);
    const spec = validateViewSpec(view.spec, snapshot.fields);
    return { ...snapshot, view, records: projectView(spec, snapshot.records) };
  }
  async create(value: unknown) {
    const input = inputObject(value),
      name = validateText(input.name, "Name", 80, true, true),
      folder = safeFolder(this.root, input.folder),
      operationId = validateOperationId(input.operationId);
    if (
      !["people", "tasks"].includes(String(input.template)) ||
      !["new", "existing"].includes(String(input.mode))
    )
      throw new ViewError(
        "INVALID_RECORD",
        "Choose a template and new/existing mode",
      );
    const template = input.template as "people" | "tasks",
      fingerprint = documentRevision(
        JSON.stringify({ name, folder, template, mode: input.mode }),
      );
    return withFileMutation(
      this.root,
      ".mindos/views/create-intent",
      async () => {
        let prior = this.list().views.find((v) => v.id === "v-" + operationId);
        const intentPath = `.mindos/views/creations/${operationId}.json`;
        if (existsSync(checkedPath(this.root, intentPath))) {
          const intent = JSON.parse(
            readFileSync(checkedPath(this.root, intentPath), "utf8"),
          );
          if (intent.fingerprint !== fingerprint)
            throw new ViewError(
              "OPERATION_CONFLICT",
              "Creation ID has different input",
              409,
            );
          if (intent.viewId) {
            prior = this.list().views.find((v) => v.id === intent.viewId);
            if (intent.status === "committed" && !prior)
              throw new ViewError(
                "VIEW_MISSING",
                "The workspace was removed; create a new request",
                404,
              );
          }
        } else {
          if (
            input.mode === "new" &&
            existsSync(checkedPath(this.root, folder))
          )
            throw new ViewError(
              "FOLDER_EXISTS",
              "Choose an empty new folder",
              409,
            );
          atomicMetadata(this.root, intentPath, {
            fingerprint,
            folder,
            template,
            status: "pending",
          });
        }
        if (prior)
          return {
            committed: true,
            operationId,
            collection: this.collection(prior.collectionId!),
            view: prior,
            viewUrl: "/studio/views/" + prior.id,
          };
        const path =
          folder + (template === "tasks" ? "/TODO.csv" : "/README.md");
        const initial =
          template === "tasks"
            ? TASK_HEADERS.join(",") + "\n"
            : "# 人脉资料\n\n人物保存在 Markdown，保留原文与私人段落。\n";
        if (input.mode === "new") {
          if (existsSync(checkedPath(this.root, path))) {
            if (readDocument(this.root, path) !== initial)
              throw new ViewError(
                "REVISION_CONFLICT",
                "Creation was interrupted and the file changed",
                409,
              );
          } else
            await this.write({ op: "create_file", path, content: initial });
        }
        if (template === "tasks") parseTasks(readDocument(this.root, path));
        else scanFolder(this.root, folder);
        const result = await withRegistry(this.root, (r) => {
          let collection = r.collections.find(
            (c) => c.folder === folder && c.template === template,
          );
          if (!collection) {
            collection = {
              id: "c-" + documentRevision(template + ":" + folder).slice(0, 24),
              folder,
              template,
              schemaVersion: 1,
            };
            r.collections.push(collection);
          }
          // Binding existing data opens its workspace. Additional projections are
          // explicit preview/save or copy operations, not duplicate collections.
          const existing = r.views.find(
            (v) => v.collectionId === collection!.id,
          );
          if (existing && input.mode === "existing")
            return { collection, view: existing };
          if (r.views.length >= 500)
            throw new ViewError(
              "VIEW_LIMIT",
              "The view limit was reached",
              409,
            );
          const date = new Date().toISOString(),
            view: ViewDefinition = {
              id: "v-" + operationId,
              name,
              folder,
              template,
              collectionId: collection.id,
              spec: defaultSpec(collection.id, template),
              version: 1,
              createdAt: date,
              updatedAt: date,
            };
          r.views.push(view);
          return { collection, view };
        });
        atomicMetadata(this.root, intentPath, {
          fingerprint,
          folder,
          template,
          status: "committed",
          viewId: result.view.id,
        });
        return {
          ...result,
          committed: true,
          operationId,
          viewUrl: "/studio/views/" + result.view.id,
          changedPaths: input.mode === "new" ? [path] : [],
        };
      },
    );
  }
  async mutate(value: unknown) {
    const request = inputObject(value);
    if (request.projectId === undefined) return this.mutateRecord(value);
    if (request.expectedRootId !== this.rootId)
      throw new ViewError("ROOT_CHANGED", "The library changed", 409);
    assertProjectPath(this.root);
    return withFileMutation(this.root, PROJECTS_PATH, async () => {
      const project = findProject(this.root, request.projectId);
      if (request.expectedProjectVersion !== project.version)
        throw new ViewError(
          "PROJECT_CHANGED",
          "Project relationships changed. Refresh before applying this action.",
          409,
        );
      const collection = this.collection(String(request.collectionId));
      const linked =
        collection.template === "tasks"
          ? project.taskCollectionIds.includes(collection.id)
          : project.personRefs.includes(
              collection.id + "/" + String(request.recordId),
            );
      if (!linked)
        throw new ViewError(
          "PROJECT_SOURCE_UNLINKED",
          "This record is no longer linked to the project",
          409,
        );
      return this.mutateRecord(value);
    });
  }
  private async mutateRecord(value: unknown) {
    const request = inputObject(value),
      collectionId = String(request.collectionId ?? ""),
      c = this.collection(collectionId),
      operationId = validateOperationId(request.operationId),
      action = String(request.action),
      input = inputObject(request.input ?? {});
    if (action === "operation.undo") {
      const previous = readReceipt(this.root, String(input.operationId));
      if (
        !["record.update", "interaction.add", "followup.update"].includes(
          previous.action ?? "",
        ) ||
        previous.before === null ||
        previous.status !== "committed" ||
        !previous.path.startsWith(c.folder + "/")
      )
        throw new ViewError(
          "INVALID_RECORD",
          "Only committed updates in this collection can be undone",
        );
      return commitViewMutation(
        this.root,
        {
          operationId,
          path: previous.path,
          expectedRevision: previous.afterRevision,
          input: { collectionId, action, input },
        },
        () => previous.before!,
        this.write,
      );
    }
    const snapshot = this.read(collectionId);
    // Receipts must replay even after the schema or data has advanced.
    const receiptPath = checkedPath(
      this.root,
      `.mindos/views/operations/${operationId}.json`,
    );
    const old = existsSync(receiptPath)
      ? readReceipt(this.root, operationId)
      : undefined;
    let path: string;
    if (c.template === "tasks") path = c.folder + "/TODO.csv";
    else if (action === "record.create")
      path = c.folder + "/人物/p-" + operationId + ".md";
    else {
      const p = snapshot.records.find((r) => r.id === request.recordId);
      if (!p)
        throw new ViewError(
          "RECORD_MISSING",
          "Person moved or was removed",
          404,
        );
      path = p.source.path;
    }
    if (old && old.path !== path)
      throw new ViewError(
        "OPERATION_CONFLICT",
        "Operation belongs to another record",
        409,
      );
    const result = await commitViewMutation(
      this.root,
      {
        operationId,
        path,
        expectedRevision: request.expectedRevision as string | undefined,
        input: {
          collectionId,
          recordId: request.recordId,
          action,
          input,
          expectedSchemaRevision: request.expectedSchemaRevision,
        },
      },
      (raw) => {
        const currentSchema =
          c.template === "tasks"
            ? parseTasks(raw!).schemaRevision
            : snapshot.schemaRevision;
        if (request.expectedSchemaRevision !== currentSchema)
          throw new ViewError(
            "SCHEMA_CHANGED",
            "Fields changed; read the collection again",
            409,
          );
        if (c.template === "tasks") {
          if (action === "schema.extend")
            return extendTaskSchema(raw!, String(input.key));
          const table = parseTasks(raw!);
          if (!["record.create", "record.update"].includes(action))
            throw new ViewError("INVALID_RECORD", "Unsupported task action");
          const allowed = Object.keys(snapshot.fields);
          if (
            Object.keys(input).some((k) => !allowed.includes(k)) ||
            Object.values(input).some((v) => typeof v !== "string")
          )
            throw new ViewError(
              "INVALID_RECORD",
              "Only defined text fields can be edited",
            );
          if (action === "record.create")
            table.rows.push(
              Object.assign(
                Object.fromEntries(table.headers.map((h) => [h, ""])),
                { id: "t-" + operationId, status: "todo" },
                input,
              ) as Record<string, string>,
            );
          else {
            const row = table.rows.find((r) => r.id === request.recordId);
            if (!row)
              throw new ViewError(
                "RECORD_MISSING",
                "Task no longer exists",
                404,
              );
            Object.assign(row, input);
          }
          return serializeTasks(table);
        }
        if (action === "record.create") {
          if (
            Object.keys(input).some(
              (k) => !["name", "background", "focus"].includes(k),
            ) ||
            Object.values(input).some((v) => typeof v !== "string")
          )
            throw new ViewError(
              "INVALID_RECORD",
              "Only defined person text fields can be created",
            );
          if (snapshot.limited || snapshot.records.length >= 500)
            throw new ViewError("VIEW_LIMIT", "Collection is full", 409);
          return newPerson("p-" + operationId, {
            name: String(input.name ?? ""),
            background: String(input.background ?? ""),
            focus: String(input.focus ?? ""),
          });
        }
        if (raw === null)
          throw new ViewError("RECORD_MISSING", "Person no longer exists", 404);
        const person = parsePerson(raw, path);
        let changed: string;
        if (action === "record.update") {
          if (
            Object.keys(input).some(
              (k) => !["name", "background", "focus"].includes(k),
            )
          )
            throw new ViewError("INVALID_RECORD", "Unknown person field");
          changed = patchFields(raw, input);
        } else if (action === "interaction.add") {
          if (input.projectId !== undefined) {
            const project = findProject(this.root, input.projectId);
            if (!project.personRefs.includes(collectionId + "/" + person.id))
              throw new ViewError(
                "PROJECT_PERSON_MISSING",
                "This person is not linked to the selected project",
                409,
              );
          }
          changed = appendInteraction(raw, {
            id: operationId,
            text: String(input.text ?? ""),
            date: String(input.date ?? ""),
            source: String(input.source ?? ""),
            ...(input.projectId !== undefined
              ? { projectId: input.projectId as string }
              : {}),
          });
        } else if (action === "followup.update")
          changed = patchFollowup(raw, {
            text: String(input.text ?? ""),
            date: String(input.date ?? ""),
            completed: input.completed === true,
          });
        else throw new ViewError("INVALID_RECORD", "Unsupported person action");
        if (!person.managed)
          changed += "\n<!-- mindos-person:" + person.id + " -->\n";
        return changed;
      },
      this.write,
    );
    return { ...result, rootId: this.rootId, collectionId };
  }
  async preview(value: unknown) {
    const input = inputObject(value);
    if (input.schemaExtension) {
      const collection = this.collection(String(input.collectionId));
      if (collection.template !== "tasks")
        throw new ViewError(
          "INVALID_RECORD",
          "Only tasks support optional fields",
        );
      const key = String(inputObject(input.schemaExtension).key),
        raw = readDocument(this.root, collection.folder + "/TODO.csv");
      const before = parseTasks(raw),
        after = parseTasks(extendTaskSchema(raw, key));
      return {
        rootId: this.rootId,
        collectionId: collection.id,
        expectedRevision: documentRevision(raw),
        expectedSchemaRevision: before.schemaRevision,
        schemaChange: {
          key,
          type: "text",
          affectedRecords: before.rows.length,
          headers: after.headers,
        },
      };
    }
    return previewWorkView(this, value);
  }
  previewRead(id: string) {
    return readWorkPreview(this, id);
  }
  save(value: unknown) {
    return saveWorkView(this, value);
  }
}
