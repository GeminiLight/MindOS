import { WorkProjectsService } from "../../knowledge/views/project-service.js";
import { WorkViewsService } from "../../knowledge/views/service.js";
import { inputObject } from "../../knowledge/views/service.js";
import { ViewError } from "../../knowledge/views/types.js";
import type { MindosHttpServices } from "../services.js";
import { json } from "../response.js";
import { viewsError, createViewsStore } from "./views.js";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function handleWorkProjectsGet(
  query: URLSearchParams,
  services: MindosHttpServices,
) {
  try {
    const projects = new WorkProjectsService(services.mindRoot);
    if (query.has("rootId") && query.get("rootId") !== projects.rootId)
      throw new ViewError("ROOT_CHANGED", "The library changed", 409);
    if (query.get("op") === "project.list")
      return json(projects.list(), { headers });
    if (query.get("op") === "project.read")
      return json(projects.read(query.get("projectId")), { headers });
    throw new ViewError("INVALID_INPUT", "Unknown project query");
  } catch (error) {
    return viewsError(error);
  }
}
export async function handleWorkProjectsPost(
  value: unknown,
  services: MindosHttpServices,
  requestHeaders?: Headers,
  signal?: AbortSignal,
) {
  try {
    const input = inputObject(value),
      projects = new WorkProjectsService(
        services.mindRoot,
        new WorkViewsService(
          services.mindRoot,
          createViewsStore(services, requestHeaders, signal).write,
        ),
        signal,
      );
    let result;
    if (input.op === "project.save") result = await projects.save(input);
    else if (input.op === "project.interact")
      result = await projects.interact(input);
    else if (input.op === "project.page")
      result = await projects.openPage(input);
    else throw new ViewError("INVALID_INPUT", "Unknown project operation");
    return json(result, { headers });
  } catch (error) {
    return viewsError(error);
  }
}
