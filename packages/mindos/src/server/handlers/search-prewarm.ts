import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export type SearchPrewarmHandlerServices = {
  collectAllFiles(): string[];
  prewarmSearch?: () => SearchPrewarmPayload;
};

export type SearchPrewarmPayload = {
  warmed: true;
  cacheState: 'hit' | 'built';
  documentCount: number;
  core: {
    cacheState: string;
    fileCount: number;
  };
};

export function handleSearchPrewarm(services: SearchPrewarmHandlerServices): MindosServerResponse<SearchPrewarmPayload> {
  if (services.prewarmSearch) {
    return json(services.prewarmSearch(), {
      headers: privateCacheHeaders(60),
    });
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
    headers: privateCacheHeaders(60),
  });
}
