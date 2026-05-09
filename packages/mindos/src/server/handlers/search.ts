import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export type SearchHandlerServices<TSearchResult = unknown> = {
  search(query: string, options: { limit: number }): Promise<TSearchResult[]>;
};

export async function handleSearch<TSearchResult>(
  query: MindosRequestQuery | undefined,
  services: SearchHandlerServices<TSearchResult>,
): Promise<MindosServerResponse<TSearchResult[]>> {
  const q = queryValue(query, 'q') ?? '';
  if (!q.trim()) return json([]);

  const results = await services.search(q, { limit: 20 });
  return json(results, { headers: privateCacheHeaders(300) });
}
