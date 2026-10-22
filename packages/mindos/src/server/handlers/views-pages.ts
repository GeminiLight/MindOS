import { WorkPagesService } from "../../knowledge/views/page-service.js";
import { inputObject } from "../../knowledge/views/service.js";
import { ViewError } from "../../knowledge/views/types.js";
import type { MindosHttpServices } from "../services.js";
import { json } from "../response.js";
import { viewsError } from "./views.js";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function handleWorkPagesGet(
  query: URLSearchParams,
  services: MindosHttpServices,
) {
  try {
    const pages = new WorkPagesService(services.mindRoot);
    if (query.has("rootId") && query.get("rootId") !== pages.rootId)
      throw new ViewError("ROOT_CHANGED", "The library changed", 409);
    const op = query.get("op");
    if (op === "page.list") return json(pages.list(), { headers });
    if (op === "page.read" || op === "page.data")
      return json(pages.read(query.get("pageId") ?? ""), { headers });
    throw new ViewError("INVALID_INPUT", "Unknown page query");
  } catch (error) {
    return viewsError(error);
  }
}
export async function handleWorkPagesPost(
  value: unknown,
  services: MindosHttpServices,
  signal?: AbortSignal,
) {
  try {
    if (signal?.aborted)
      throw new ViewError(
        "REQUEST_CANCELLED",
        "The request was cancelled",
        499,
      );
    const input = inputObject(value),
      pages = new WorkPagesService(services.mindRoot, undefined, signal);
    switch (input.op) {
      case "page.preview":
        return json(pages.preview(input), { headers });
      case "page.save":
        return json(await pages.save(input), { headers });
      case "page.restore":
        return json(await pages.restore(input), { headers });
      case "page.remove":
        return json(await pages.remove(input), { headers });
      default:
        throw new ViewError("INVALID_INPUT", "Unknown page operation");
    }
  } catch (error) {
    return viewsError(error);
  }
}
