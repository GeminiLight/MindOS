export const dynamic = 'force-dynamic';
import { collectAllFiles } from '@/lib/fs';
import { NextResponse, NextRequest } from 'next/server';
import { handleRouteErrorSimple } from '@/lib/errors';

export async function GET(req: NextRequest) {
  try {
    const files = collectAllFiles();
    
    // Optional pagination (only apply if both limit and offset are provided)
    if (req) {
      const searchParams = req.nextUrl.searchParams;
      const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : null;
      const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;
      
      if (limit && limit > 0) {
        const paged = files.slice(offset, offset + limit);
        return NextResponse.json({
          files: paged,
          total: files.length,
          offset,
          limit,
        });
      }
    }
    
    // Default: return flat array for backward compatibility
    return NextResponse.json(files);
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
