import {
  handleWorkViewsGet,
  handleWorkViewsPost,
} from "../handlers/views-v2.js";
import { defineRoutes } from "../route-table.js";
import { handleViewsGet, handleViewsPost } from "../handlers/views.js";
export const viewRoutes = defineRoutes([
  {
    id: "views.v2.read",
    method: "GET",
    path: "/api/views/v2",
    auth: "required",
    handler: ({ query, services }) => handleWorkViewsGet(query, services),
  },
  {
    id: "views.v2.write",
    method: "POST",
    path: "/api/views/v2",
    auth: "required",
    handler: async ({ readJsonBody, services, headers, signal }) =>
      handleWorkViewsPost(
        await readJsonBody(80_000),
        services,
        headers,
        signal,
      ),
  },
  {
    id: "views.read",
    method: "GET",
    path: "/api/views",
    auth: "required",
    handler: ({ query, services }) => handleViewsGet(query, services),
  },
  {
    id: "views.write",
    method: "POST",
    path: "/api/views",
    auth: "required",
    handler: async ({ readJsonBody, services, headers, signal }) =>
      handleViewsPost(await readJsonBody(80_000), services, headers, signal),
  },
]);
