import { handlePageGenerate } from "./views-page-generate.js";
import { handleWorkPagesGet, handleWorkPagesPost } from "./views-pages.js";
import {
  WorkViewsService,
  inputObject,
} from "../../knowledge/views/service.js";
import { ViewError } from "../../knowledge/views/types.js";
import { readReceipt } from "../../knowledge/views/operations.js";
import { mindRootIdentity } from "../root-identity.js";
import type { MindosHttpServices } from "../services.js";
import { json } from "../response.js";
import { createViewsStore, viewsError } from "./views.js";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function workViews(
  services: MindosHttpServices,
  requestHeaders?: Headers,
  signal?: AbortSignal,
) {
  return new WorkViewsService(
    services.mindRoot,
    createViewsStore(services, requestHeaders, signal).write,
  );
}
export function handleWorkViewsGet(
  query: URLSearchParams,
  services: MindosHttpServices,
) {
  try {
    const s = workViews(services);
    if (query.has("rootId") && query.get("rootId") !== s.rootId)
      throw new ViewError("ROOT_CHANGED", "Library changed", 409);
    const op = query.get("op") ?? "list",
      id = query.get("collectionId") ?? "";
    if (op.startsWith("page.")) return handleWorkPagesGet(query, services);
    if (op === "describe" || op === "doctor" || op === "templates")
      return json(s.describe(id || undefined), { headers });
    if (op === "list") return json(s.list(), { headers });
    if (op === "related")
      return json(s.related(id, query.get("personId") ?? ""), { headers });
    if (op === "read") {
      const data = query.get("viewId")
        ? s.view(query.get("viewId")!)
        : s.read(id);
      const offset = Number(query.get("offset") ?? 0);
      const limit = Number(query.get("limit") ?? 500);
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500
      )
        throw new ViewError("INVALID_INPUT", "Invalid pagination");
      if (query.has("recordId"))
        data.records = data.records.filter(
          (r) => r.id === query.get("recordId"),
        );
      if (query.has("fields")) {
        const keys = query.get("fields")!.split(",");
        if (!keys.length || keys.some((key) => !(key in data.fields)))
          throw new ViewError("INVALID_INPUT", "Unknown projected field");
        data.records = data.records.map((record) => ({
          ...record,
          fields: Object.fromEntries(
            keys.map((key) => [key, record.fields[key] ?? ""]),
          ),
        }));
      }
      const total = data.records.length;
      return json(
        {
          ...data,
          records: data.records.slice(offset, offset + limit),
          total,
          offset,
          nextOffset: offset + limit < total ? offset + limit : null,
        },
        { headers },
      );
    }
    if (op === "preview")
      return json(s.previewRead(query.get("draftId") ?? ""), { headers });
    if (op === "operation") {
      const r = readReceipt(s.root, query.get("operationId") ?? "");
      return json(
        {
          rootId: s.rootId,
          operationId: r.operationId,
          status: r.status,
          committed: r.status === "committed",
          sourcePath: r.path,
          newRevision: r.afterRevision,
        },
        { headers },
      );
    }
    throw new ViewError("INVALID_INPUT", "Unknown views query");
  } catch (e) {
    return viewsError(e);
  }
}
export async function handleWorkViewsPost(
  body: unknown,
  services: MindosHttpServices,
  requestHeaders: Headers,
  signal?: AbortSignal,
) {
  try {
    const input = inputObject(body);
    if (input.expectedRootId !== mindRootIdentity(services.mindRoot))
      throw new ViewError(
        "ROOT_CHANGED",
        "Library changed; reconnect before saving",
        409,
      );
    if (input.op === "page.generate")
      return handlePageGenerate(input, services, signal);
    if (typeof input.op === "string" && input.op.startsWith("page."))
      return handleWorkPagesPost(input, services, signal);
    const s = workViews(services, requestHeaders, signal);
    let result: unknown;
    switch (input.op) {
      case "create":
        result = await s.create(input);
        break;
      case "mutate":
        result = await s.mutate(input);
        break;
      case "preview":
        result = await s.preview(input);
        break;
      case "save":
        result = await s.save(input);
        break;
      default:
        throw new ViewError("INVALID_INPUT", "Unknown views operation");
    }
    return json(result, { headers });
  } catch (e) {
    return viewsError(e);
  }
}
