import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export type SearchPrewarmPayload = {
  warmed: true;
  cacheState: 'hit' | 'built';
  documentCount: number;
  core: {
    cacheState: string;
    fileCount: number;
    /** Text documents actually held by the search index (md/csv/json). */
    indexedDocuments?: number;
  };
};

export type SearchPrewarmHandlerServices = {
  collectAllFiles(): string[];
  prewarmSearch?: () => SearchPrewarmPayload;
};

/** Hosts whose warm-up is asynchronous (e.g. a worker-built core index) resolve the payload. */
export type SearchPrewarmHandlerServicesWithAsyncWarmup = {
  collectAllFiles(): string[];
  prewarmSearch?: () => SearchPrewarmPayload | Promise<SearchPrewarmPayload>;
};

const PREWARM_HEADERS = () => privateCacheHeaders(60);

export function handleSearchPrewarm(services: SearchPrewarmHandlerServices): MindosServerResponse<SearchPrewarmPayload>;
export function handleSearchPrewarm(
  services: SearchPrewarmHandlerServicesWithAsyncWarmup,
): MindosServerResponse<SearchPrewarmPayload> | Promise<MindosServerResponse<SearchPrewarmPayload>>;
export function handleSearchPrewarm(
  services: SearchPrewarmHandlerServicesWithAsyncWarmup,
): MindosServerResponse<SearchPrewarmPayload> | Promise<MindosServerResponse<SearchPrewarmPayload>> {
  if (services.prewarmSearch) {
    const payload = services.prewarmSearch();
    if (payload instanceof Promise) {
      return payload.then((resolved) => json(resolved, { headers: PREWARM_HEADERS() }));
    }
    return json(payload, { headers: PREWARM_HEADERS() });
  }

  const files = services.collectAllFiles();
  return json({
    warmed: true,
    cacheState: 'built',
    documentCount: files.length,
    core: {
      cacheState: 'built',
      fileCount: files.length,
    },
  }, {
    headers: PREWARM_HEADERS(),
  });
}
