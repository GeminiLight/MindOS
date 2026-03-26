import { NextResponse } from 'next/server';
import { getTreeVersion } from '@/lib/fs';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ v: getTreeVersion() });
}
