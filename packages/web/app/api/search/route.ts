export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { hybridSearch } from '@/lib/core/hybrid-search';
import { effectiveSopRoot } from '@/lib/settings';
import { setPrivateCacheHeaders } from '@/lib/api-cache-headers';
import { handleRouteErrorSimple } from '@/lib/errors';
import { telemetry } from '@/lib/telemetry';
import type { SearchResult } from '@/lib/types';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') || '';
  if (!q.trim()) {
    return NextResponse.json([]);
  }

  const stop = telemetry.startTimer('search.api.request', { queryLen: q.length });
  try {
    const mindRoot = effectiveSopRoot();
    const results: SearchResult[] = await hybridSearch(mindRoot, q, { limit: 20 });
    stop({ resultCount: results.length, success: true });
    
    const response = NextResponse.json(results);
    
    // ── Cache control: private, 5 minutes ──
    // Search results are user-specific (reflect user's knowledge base state).
    // Use "private" to prevent CDN caching, but allow browser cache for repeated searches.
    // 5 minute TTL balances UX (fast repeated searches) with freshness.
    return setPrivateCacheHeaders(response, 300);
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
