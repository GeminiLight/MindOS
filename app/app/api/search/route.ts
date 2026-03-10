import { NextRequest, NextResponse } from 'next/server';
import { searchFiles } from '@/lib/fs';

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
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
