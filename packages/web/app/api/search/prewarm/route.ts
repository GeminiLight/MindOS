export const dynamic = 'force-dynamic';

import { handleSearchPrewarm } from '@geminilight/mindos/server';
import { prewarmSearchIndex, getMindRoot } from '@/lib/fs';
import { prewarmCoreSearchIndex } from '@/lib/core/search';
import { handleRouteErrorSimple } from '@/lib/errors';
import { telemetry } from '@/lib/telemetry';
import { toNextResponse } from '../../_mindos-adapter';

export async function GET() {
  const stop = telemetry.startTimer('search.prewarm.request');
  try {
    const uiResult = prewarmSearchIndex();
    let coreResult: { cacheState: string; fileCount: number } | undefined;
    try {
      coreResult = await prewarmCoreSearchIndex(getMindRoot());
    } catch {
      // Core prewarm failure is non-critical; UI search still works.
    }

    stop({
      uiCacheState: uiResult.cacheState,
      uiDocumentCount: uiResult.documentCount,
      coreCacheState: coreResult?.cacheState ?? 'skipped',
      coreFileCount: coreResult?.fileCount ?? 0,
      success: true,
    });

    return toNextResponse(handleSearchPrewarm({
      collectAllFiles: () => [],
      prewarmSearch: () => ({
        ...uiResult,
        core: coreResult
          ? { cacheState: coreResult.cacheState, fileCount: coreResult.fileCount }
          : { cacheState: 'skipped', fileCount: 0 },
      }),
    }));
  } catch (error) {
    telemetry.track('search.prewarm.error', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    stop({ success: false });
    return handleRouteErrorSimple(error);
  }
}
