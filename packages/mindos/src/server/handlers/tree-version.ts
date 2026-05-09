import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export type TreeVersionHandlerServices = {
  getTreeVersion(): number;
};

export type TreeVersionPayload = {
  v: number;
};

export function handleTreeVersion(services: TreeVersionHandlerServices): MindosServerResponse<TreeVersionPayload> {
  return json({ v: services.getTreeVersion() }, {
    headers: privateCacheHeaders(0),
  });
}
