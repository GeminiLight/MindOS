import { defineRoutes } from "../route-table.js";
import {
  handleContextWorkGet,
  handleContextWorkPost,
} from "../handlers/context-work.js";
export const contextWorkRoutes = defineRoutes([
  {
    id: "context-work.read",
    method: "GET",
    path: "/api/context-work",
    auth: "required",
    handler: ({ query, services }) => handleContextWorkGet(query, services),
  },
  {
    id: "context-work.write",
    method: "POST",
    path: "/api/context-work",
    auth: "required",
    handler: async ({ readJsonBody, services, headers, signal }) =>
      handleContextWorkPost(
        await readJsonBody(64_000),
        services,
        headers,
        signal,
      ),
  },
]);
