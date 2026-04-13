export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { findBacklinks } from '@/lib/fs';
import { generateETag, setPublicCacheHeaders } from '@/lib/api-cache-headers';
import { handleRouteErrorSimple } from '@/lib/errors';

// GET /api/backlinks?path=Profile/Identity.md
// Returns: Array<{ filePath: string; snippets: string[] }>
// (transforms core BacklinkEntry shape to frontend-expected shape)
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('path');
  if (!target) return NextResponse.json({ error: 'path required' }, { status: 400 });

  try {
    const backlinks = findBacklinks(target);
    const data = backlinks.map(b => ({
      filePath: b.source,
      snippets: [b.context],
    }));
    
    const response = NextResponse.json(data);
    
    // ── Cache control: 5 minutes ──
    // Backlinks are stable for a given file until link structure changes.
    // ETag derived from serialized data ensures content-based invalidation.
    const etag = generateETag(JSON.stringify(data));
    return setPublicCacheHeaders(response, 300, etag);
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
