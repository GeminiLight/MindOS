import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export type RecentFile = {
  path: string;
  mtime: number;
};

export type RecentFilesHandlerServices = {
  getRecentlyModified(limit: number): RecentFile[];
};

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 10;
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(parsed, 30));
}

export function handleRecentFiles(
  query: MindosRequestQuery | undefined,
  services: RecentFilesHandlerServices,
): MindosServerResponse<RecentFile[]> {
  const limit = parseLimit(queryValue(query, 'limit'));
  return json(services.getRecentlyModified(limit), { headers: privateCacheHeaders(30) });
}
