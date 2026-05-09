export const dynamic = 'force-dynamic';
import { handleSearch } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { hybridSearch } from '@/lib/core/hybrid-search';
import { effectiveSopRoot } from '@/lib/settings';
import { toNextResponse } from '../_mindos-adapter';
import { handleRouteErrorSimple } from '@/lib/errors';
import { telemetry } from '@/lib/telemetry';
import type { SearchResult } from '@/lib/types';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') || '';
  const stop = telemetry.startTimer('search.api.request', { queryLen: q.length });
  try {
    const mindRoot = effectiveSopRoot();
    const response = await handleSearch<SearchResult>(request.nextUrl.searchParams, {
      search: (query, options) => hybridSearch(mindRoot, query, options),
    });
    const results = Array.isArray(response.body) ? response.body : [];
    stop({ resultCount: results.length, success: true });
    return toNextResponse(response);
  } catch (err) {
    telemetry.track('search.api.error', {
      queryLen: q.length,
      errorType: err instanceof Error ? err.name : 'unknown',
    });
    stop({ success: false });
    console.error('Search error:', err);
    return handleRouteErrorSimple(err);
  }
}
