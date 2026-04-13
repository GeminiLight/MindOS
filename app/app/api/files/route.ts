export const dynamic = 'force-dynamic';
import { collectAllFiles } from '@/lib/fs';
import { NextResponse, NextRequest } from 'next/server';
import { generateETag, setPublicCacheHeaders } from '@/lib/api-cache-headers';
import { handleRouteErrorSimple } from '@/lib/errors';

export async function GET(req: NextRequest) {
  try {
    const files = collectAllFiles();
    
    // Optional pagination (only apply if both limit and offset are provided)
    const searchParams = req?.nextUrl?.searchParams;
    const limit = searchParams?.get('limit') ? parseInt(searchParams.get('limit')!, 10) : null;
    const offset = searchParams?.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;
    
    let data: unknown;
    if (limit && limit > 0) {
      const paged = files.slice(offset, offset + limit);
      data = { files: paged, total: files.length, offset, limit };
    } else {
      // Default: return flat array for backward compatibility
      data = files;
    }
    
    const response = NextResponse.json(data);
    
    // ── Cache control: 1 minute ──
    // File list changes when files are created/renamed/deleted.
    // ETag derived from full file list hash ensures any change invalidates cache.
    // For large lists (5000+ files), join is O(n) but still <1ms — acceptable.
    const etag = generateETag(files.join('\n'));
    return setPublicCacheHeaders(response, 60, etag);
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
