export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { searchFiles } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') || '';
  if (!q.trim()) {
    return NextResponse.json([]);
  }
  try {
    const results = searchFiles(q);
    return NextResponse.json(results);
  } catch (err) {
    console.error('Search error:', err);
    return handleRouteErrorSimple(err);
  }
}
