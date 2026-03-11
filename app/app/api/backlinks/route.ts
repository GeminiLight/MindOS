export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { findBacklinks } from '@/lib/fs';

// GET /api/backlinks?path=Profile/Identity.md
// Returns: Array<{ filePath: string; snippets: string[] }>
// (transforms core BacklinkEntry shape to frontend-expected shape)
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('path');
  if (!target) return NextResponse.json({ error: 'path required' }, { status: 400 });

  try {
    const backlinks = findBacklinks(target);
    // Transform core shape { source, line, context } → frontend shape { filePath, snippets }
    return NextResponse.json(backlinks.map(b => ({
      filePath: b.source,
      snippets: [b.context],
    })));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
