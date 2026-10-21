import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { checkedPath } from "./paths.js";
import { atomicMetadata } from "./operations.js";
import {
  validateId,
  validateOperationId,
  validateText,
  documentRevision,
} from "./markdown.js";
import { ViewError, type ViewDefinition } from "./types.js";
import { withRegistry } from "./registry.js";
import {
  defaultSpec,
  validateViewSpec,
  projectView,
  type ViewSpec,
} from "./view-spec.js";
import { inputObject, type WorkViewsService } from "./service.js";
type Draft = {
  draftId: string;
  rootId: string;
  collectionId: string;
  spec: ViewSpec;
  schemaRevision: string;
  expiresAt: number;
};
export async function previewWorkView(
  service: WorkViewsService,
  value: unknown,
) {
  const input = inputObject(value),
    collectionId = String(input.collectionId ?? ""),
    data = service.read(collectionId),
    spec = validateViewSpec(input.spec, data.fields);
  if (spec.collectionId !== collectionId)
    throw new ViewError("INVALID_VIEW", "View belongs to another collection");
  const draft: Draft = {
    draftId: "d-" + randomUUID(),
    rootId: service.rootId,
    collectionId,
    spec,
    schemaRevision: data.schemaRevision,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };
  atomicMetadata(
    service.root,
    `.mindos/views/drafts/${draft.draftId}.json`,
    draft,
  );
  return {
    ...draft,
    previewUrl: "/studio/views/preview/" + draft.draftId,
    recordCount: projectView(spec, data.records).length,
  };
}
export function readWorkPreview(service: WorkViewsService, id: string) {
  validateId(id);
  const file = checkedPath(service.root, `.mindos/views/drafts/${id}.json`);
  if (statSync(file).size > 40000)
    throw new ViewError("INVALID_VIEW", "Draft exceeds size limit");
  const draft = JSON.parse(readFileSync(file, "utf8")) as Draft;
  if (
    draft.rootId !== service.rootId ||
    draft.draftId !== id ||
    draft.expiresAt < Date.now()
  )
    throw new ViewError(
      "PREVIEW_EXPIRED",
      "Preview expired; generate it again",
      410,
    );
  const data = service.read(draft.collectionId),
    spec = validateViewSpec(draft.spec, data.fields);
  if (data.schemaRevision !== draft.schemaRevision)
    throw new ViewError(
      "SCHEMA_CHANGED",
      "Collection fields changed; preview again",
      409,
    );
  return { ...data, ...draft, records: projectView(spec, data.records) };
}
export async function saveWorkView(service: WorkViewsService, value: unknown) {
  const input = inputObject(value),
    operationId = validateOperationId(input.operationId),
    action = String(input.action ?? "save");
  const fingerprint = documentRevision(JSON.stringify(input));
  return withRegistry(service.root, (r) => {
    // Receipts live in the same atomic registry replacement as config changes.
    const registry = r as typeof r & {
      configOperations?: Record<
        string,
        { fingerprint: string; result: unknown }
      >;
    };
    registry.configOperations ??= {};
    const replay = registry.configOperations[operationId];
    if (replay) {
      if (replay.fingerprint !== fingerprint)
        throw new ViewError(
          "OPERATION_CONFLICT",
          "Operation ID has different input",
          409,
        );
      return replay.result;
    }
    const draft = input.draftId
      ? readWorkPreview(service, String(input.draftId))
      : undefined;
    let view = r.views.find((v) => v.id === input.viewId);
    if (input.viewId && (!view || input.expectedViewVersion !== view.version))
      throw new ViewError(
        "VIEW_CONFLICT",
        "View changed; reload before saving",
        409,
      );
    if (action === "remove") {
      if (!view) throw new ViewError("VIEW_MISSING", "Choose a view", 404);
      r.views = r.views.filter((v) => v !== view);
    } else if (view) {
      if (action === "restore") {
        if (!view.previousSpec)
          throw new ViewError("INVALID_VIEW", "No previous definition");
        const previous = view.spec;
        view.spec = view.previousSpec;
        view.previousSpec = previous;
      } else if (action === "save") {
        if (draft) {
          if (draft.collectionId !== view.collectionId)
            throw new ViewError(
              "INVALID_VIEW",
              "Cannot rebind a view through a preview",
            );
          view.previousSpec =
            view.spec ?? defaultSpec(view.collectionId!, view.template);
          view.spec = draft.spec;
        }
        if (input.name !== undefined)
          view.name = validateText(input.name, "Name", 80, true, true);
        if (typeof input.pinned === "boolean") view.pinned = input.pinned;
      } else if (action === "copy") {
        view = {
          ...view,
          id: "v-" + operationId,
          name: validateText(input.name ?? view.name, "Name", 80, true, true),
          version: 0,
        };
        r.views.push(view);
      } else throw new ViewError("INVALID_VIEW", "Unsupported save action");
      view.version++;
      view.updatedAt = new Date().toISOString();
    } else {
      if (!draft || action !== "save")
        throw new ViewError(
          "INVALID_VIEW",
          "Preview a definition before saving",
        );
      const c = r.collections.find((c) => c.id === draft.collectionId)!;
      const date = new Date().toISOString();
      view = {
        id: "v-" + operationId,
        name: validateText(input.name, "Name", 80, true, true),
        folder: c.folder,
        template: c.template,
        collectionId: c.id,
        spec: draft.spec,
        version: 1,
        createdAt: date,
        updatedAt: date,
      };
      r.views.push(view);
    }
    const result = {
      rootId: service.rootId,
      operationId,
      committed: true,
      view: action === "remove" ? undefined : view,
      viewUrl:
        action === "remove" ? "/studio/views" : "/studio/views/" + view!.id,
    };
    registry.configOperations[operationId] = { fingerprint, result };
    return result;
  });
}
