import { NextRequest, NextResponse } from 'next/server';
import { getRecentlyModified } from '@/lib/fs';

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 10;
  const files = getRecentlyModified(Math.min(limit, 30));
  return NextResponse.json(files);
}
