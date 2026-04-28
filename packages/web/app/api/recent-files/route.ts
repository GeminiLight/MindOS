export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getRecentlyModified } from '@/lib/fs';

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get('limit');
  const raw = limitParam ? parseInt(limitParam, 10) : 10;
  const limit = Number.isFinite(raw) ? raw : 10;
  const files = getRecentlyModified(Math.max(1, Math.min(limit, 30)));
  return NextResponse.json(files);
}
