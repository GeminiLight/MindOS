import { existsSync, lstatSync } from "node:fs";
import { posix } from "node:path";
import {
  ViewError,
  type ViewDefinition,
  type ViewSummary,
  type ViewKnowledgeWriter,
  type PersonFields,
  type PersonDocument,
  type ViewCollection,
  type ViewPreview,
} from "./types.js";
import {
  appendInteraction,
  documentRevision,
  newPerson,
  parsePerson,
  patchFields,
  patchFollowup,
  validateId,
  validateOperationId,
  validateText,
} from "./markdown.js";
import {
  checkedPath,
  pathInsideFolder,
  readDocument,
  requireFolder,
  safeFolder,
  scanFolder,
  summary,
} from "./paths.js";
import { readRegistry, withRegistry, type ViewRegistry } from "./registry.js";
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ViewError("INVALID_INPUT", "Invalid request fields");
  return value as Record<string, unknown>;
};
function find(registry: ViewRegistry, id: string): ViewDefinition {
  validateId(id);
  const v = registry.views.find((v) => v.id === id);
  if (!v)
    throw new ViewError("VIEW_MISSING", "This view no longer exists", 404);
  return v;
}
function checkedVersion(v: ViewDefinition, value: unknown) {
  if (!Number.isInteger(value) || value !== v.version)
    throw new ViewError(
      "VIEW_CONFLICT",
      "The view configuration changed. Reload it before saving",
      409,
    );
}
const now = () => new Date().toISOString();
const instruction = `# 人脉资料使用说明\n\n人物资料保存在人物 Markdown 中。会前先读取当前背景、互动与未完成跟进，标注来源；不要补造人物事实。\n\n私人反思和未知段落不会自动进入会前材料。更新前读取当前版本，保留已有段落；写回后读回核对。\n`;
export class ViewsStore {
  constructor(
    readonly root: string,
    readonly write: ViewKnowledgeWriter,
  ) {}
  private annotate(v: ViewDefinition): ViewSummary {
    let availability: ViewSummary["availability"] = "ready";
    try {
      const s = lstatSync(checkedPath(this.root, v.folder));
      if (!s.isDirectory()) availability = "unavailable";
    } catch (e) {
      availability =
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unavailable";
    }
    return { ...v, availability };
  }
  list(): ViewSummary[] {
    return readRegistry(this.root)
      .views.map((v) => this.annotate(v))
      .sort((a, b) =>
        (b.lastOpenedAt || b.updatedAt).localeCompare(
          a.lastOpenedAt || a.updatedAt,
        ),
      );
  }
  preview(folderValue: unknown): ViewPreview {
    const folder = safeFolder(this.root, folderValue);
    const data = scanFolder(this.root, folder);
    const existing = this.list().find((v) => v.folder === folder);
    return {
      folder,
      people: data.people
        .slice(0, 6)
        .map((p) => ({ id: p.id, name: p.name, path: p.path })),
      personCount: data.people.length,
      fileCount: data.files.length,
      skipped: data.skipped,
      limited: data.limited,
      ...(existing ? { existingView: existing } : {}),
    };
  }
  read(id: string): ViewCollection {
    const v = find(readRegistry(this.root), id);
    const data = scanFolder(this.root, v.folder);
    return {
      view: this.annotate(v),
      people: data.people.map(summary),
      files: data.files,
      skipped: data.skipped,
      limited: data.limited,
    };
  }
  person(id: string, personId: string, path?: string): PersonDocument {
    const v = find(readRegistry(this.root), id);
    requireFolder(this.root, v.folder);
    validateId(personId);
    if (path) {
      const safe = pathInsideFolder(this.root, v.folder, path);
      const p = parsePerson(readDocument(this.root, safe), safe);
      if (p.id !== personId)
        throw new ViewError(
          "PERSON_MISSING",
          "The original person file changed identity",
          404,
        );
      return p;
    }
    const p = scanFolder(this.root, v.folder).people.find(
      (p) => p.id === personId,
    );
    if (!p)
      throw new ViewError(
        "PERSON_MISSING",
        "The person document was moved or removed",
        404,
      );
    return p;
  }
  raw(
    id: string,
    path: string,
  ): { content: string; revision: string; path: string } {
    const v = find(readRegistry(this.root), id);
    const relative = posix.relative(v.folder, path);
    if (
      !relative ||
      relative.startsWith("..") ||
      posix.isAbsolute(relative) ||
      path.split("/").some((part) => part.startsWith("."))
    )
      throw new ViewError(
        "ACCESS_DENIED",
        "The file is outside this view",
        403,
      );
    const content = readDocument(this.root, path);
    return { path, content, revision: documentRevision(content) };
  }
  async create(value: unknown): Promise<ViewSummary> {
    const input = object(value);
    const name = validateText(input.name, "View name", 80, true, true);
    const folder = safeFolder(this.root, input.folder);
    const operationId = validateOperationId(input.operationId);
    if (!["new", "existing"].includes(String(input.mode)))
      throw new ViewError("INVALID_INPUT", "Choose new or existing data");
    return withRegistry(this.root, async (registry) => {
      const replay = registry.views.find((v) => v.id === "v-" + operationId);
      if (replay) {
        if (replay.folder !== folder || replay.name !== name)
          throw new ViewError(
            "OPERATION_CONFLICT",
            "This request was already used with different fields",
            409,
          );
        return this.annotate(replay);
      }
      const existing = registry.views.find((v) => v.folder === folder);
      if (existing) return this.annotate(existing);
      if (registry.views.length >= 500)
        throw new ViewError("VIEW_LIMIT", "The view limit was reached", 409);
      if (input.mode === "existing") requireFolder(this.root, folder);
      else {
        const absolute = checkedPath(this.root, folder);
        const marker = `<!-- mindos-view-folder:${operationId} -->`;
        const readmePath = posix.join(folder, "README.md");
        if (existsSync(absolute)) {
          let ours = false;
          try {
            ours = readDocument(this.root, readmePath).includes(marker);
          } catch { /* Preserve the original state when no temporary file is present. */ }
          if (!ours)
            throw new ViewError(
              "FOLDER_EXISTS",
              "This folder already exists. Associate it instead",
              409,
            );
        }

        for (const [file, content] of [
          [
            "README.md",
            `# ${name}\n${marker}\n\n人物与互动保留在普通 Markdown 中；视图提供维护与会前准备。\n`,
          ],
          ["INSTRUCTION.md", instruction],
        ] as const) {
          const path = posix.join(folder, file);
          if (!existsSync(checkedPath(this.root, path)))
            await this.write({ op: "create_file", path, content });
        }
      }
      const timestamp = now();
      const view: ViewDefinition = {
        id: "v-" + operationId,
        name,
        folder,
        template: "people",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      registry.views.push(view);
      return this.annotate(view);
    });
  }
  async rename(
    id: string,
    name: unknown,
    version: unknown,
  ): Promise<ViewSummary> {
    const label = validateText(name, "View name", 80, true, true);
    return withRegistry(this.root, (registry) => {
      const v = find(registry, id);
      checkedVersion(v, version);
      v.name = label;
      v.version++;
      v.updatedAt = now();
      return this.annotate(v);
    });
  }
  async rebind(
    id: string,
    value: unknown,
    version: unknown,
  ): Promise<ViewSummary> {
    const folder = safeFolder(this.root, value);
    requireFolder(this.root, folder);
    return withRegistry(this.root, (registry) => {
      const v = find(registry, id);
      checkedVersion(v, version);
      if (
        registry.views.some(
          (other) => other.id !== id && other.folder === folder,
        )
      )
        throw new ViewError(
          "VIEW_EXISTS",
          "Another view already uses this folder",
          409,
        );
      v.folder = folder;
      delete v.lastPersonId;
      delete v.lastPersonName;
      v.version++;
      v.updatedAt = now();
      return this.annotate(v);
    });
  }
  async remove(id: string, version: unknown): Promise<void> {
    return withRegistry(this.root, (registry) => {
      const v = registry.views.find((v) => v.id === id);
      if (!v) return;
      checkedVersion(v, version);
      registry.views = registry.views.filter((v) => v.id !== id);
    });
  }
  async remember(
    id: string,
    personId: string,
    path?: string,
  ): Promise<ViewSummary> {
    const p = this.person(id, personId, path);
    return withRegistry(this.root, (registry) => {
      const v = find(registry, id);
      v.lastOpenedAt = now();
      v.lastPersonId = p.id;
      v.lastPersonName = p.name;
      return this.annotate(v);
    });
  }
  async addPerson(id: string, value: unknown): Promise<PersonDocument> {
    const input = object(value);
    const op = validateOperationId(input.operationId);
    const fields = object(input.fields) as PersonFields;
    const content = newPerson("p-" + op, fields);
    const fingerprint = documentRevision(
      JSON.stringify({
        name: validateText(fields.name, "Name", 80, true, true),
        background: validateText(fields.background, "Background", 8000),
        focus: validateText(fields.focus, "Focus", 8000),
      }),
    );
    return withRegistry(this.root, async (registry) => {
      const v = find(registry, id);
      requireFolder(this.root, v.folder);
      const snapshot = scanFolder(this.root, v.folder);
      const existing = snapshot.people.find((p) => p.id === "p-" + op);
      if (existing) {
        const raw = readDocument(this.root, existing.path);
        if (!raw.includes(`<!-- mindos-person-create:${op}:${fingerprint} -->`))
          throw new ViewError(
            "OPERATION_CONFLICT",
            "This request was used with different fields",
            409,
          );
        return existing;
      }
      if (snapshot.limited || snapshot.people.length >= 500)
        throw new ViewError(
          "VIEW_LIMIT",
          "Narrow the bound folder before adding more records",
          409,
        );
      let label = "";
      // eslint-disable-next-line no-control-regex
      for (const c of fields.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")) {
        if (Buffer.byteLength(label + c) > 80) break;
        label += c;
      }
      label = label.trim().replace(/[. ]+$/, "") || "人物";
      const path = posix.join(v.folder, "人物", `${label} - ${op}.md`);
      const tagged = content.replace(
        /^(# [^\n]+\n)/,
        `$1<!-- mindos-person-create:${op}:${fingerprint} -->\n`,
      );
      await this.write({ op: "create_file", path, content: tagged });
      return parsePerson(readDocument(this.root, path), path);
    });
  }
  private async update(
    id: string,
    personId: string,
    input: Record<string, unknown>,
    change: (content: string) => string,
  ): Promise<PersonDocument> {
    return withRegistry(this.root, async () => {
      const p = this.person(
        id,
        personId,
        typeof input.path === "string" ? input.path : undefined,
      );
      if (
        typeof input.expectedRevision !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.expectedRevision)
      )
        throw new ViewError("INVALID_INPUT", "A document revision is required");
      const raw = readDocument(this.root, p.path);
      const content = change(raw);
      // Identical interaction retries return the current record, even if subsequent edits changed its revision.
      if (content === raw) return parsePerson(raw, p.path);
      if (p.revision !== input.expectedRevision)
        throw new ViewError(
          "REVISION_CONFLICT",
          "The original file changed. Your draft is preserved",
          409,
        );
      await this.write({
        op: "save_file",
        path: p.path,
        content,
        expectedRevision: p.revision,
      });
      return parsePerson(readDocument(this.root, p.path), p.path);
    });
  }
  updatePerson(
    id: string,
    personId: string,
    value: unknown,
  ): Promise<PersonDocument> {
    const input = object(value);
    const fields = object(input.fields);
    return this.update(id, personId, input, (raw) =>
      patchFields(raw, fields as Partial<PersonFields>),
    );
  }
  interaction(
    id: string,
    personId: string,
    value: unknown,
  ): Promise<PersonDocument> {
    const input = object(value);
    const operationId = validateOperationId(input.operationId);
    return this.update(id, personId, input, (raw) =>
      appendInteraction(raw, {
        id: operationId,
        text: input.text as string,
        date: input.date as string,
        source: (input.source ?? "") as string,
      }),
    );
  }
  followup(
    id: string,
    personId: string,
    value: unknown,
  ): Promise<PersonDocument> {
    const input = object(value);
    return this.update(id, personId, input, (raw) =>
      patchFollowup(raw, {
        text: input.text as string,
        date: input.date as string,
        completed: input.completed as boolean,
      }),
    );
  }
}
