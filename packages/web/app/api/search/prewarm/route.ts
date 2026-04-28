export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prewarmSearchIndex, getMindRoot } from '@/lib/fs';
import { prewarmCoreSearchIndex } from '@/lib/core/search';
import { handleRouteErrorSimple } from '@/lib/errors';
import { telemetry } from '@/lib/telemetry';

export async function GET() {
  const stop = telemetry.startTimer('search.prewarm.request');
  try {
    const uiResult = prewarmSearchIndex();

    // Also prewarm Core (BM25) search index used by MCP/Agent
    let coreResult: { cacheState: string; fileCount: number } | undefined;
    try {
      const mindRoot = getMindRoot();
      coreResult = await prewarmCoreSearchIndex(mindRoot);
    } catch {
      // Core prewarm failure is non-critical — UI search still works
    }

    stop({
      uiCacheState: uiResult.cacheState,
      uiDocumentCount: uiResult.documentCount,
      coreCacheState: coreResult?.cacheState ?? 'skipped',
      coreFileCount: coreResult?.fileCount ?? 0,
      success: true,
    });
    return NextResponse.json({
      ...uiResult,
      core: coreResult ? { cacheState: coreResult.cacheState, fileCount: coreResult.fileCount } : undefined,
    });
  } catch (err) {
    telemetry.track('search.prewarm.error', {
      errorType: err instanceof Error ? err.name : 'unknown',
    });
    stop({ success: false });
    return handleRouteErrorSimple(err);
  }
}
