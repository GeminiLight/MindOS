export const dynamic = 'force-dynamic';
import { collectAllFiles } from '@/lib/fs';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const files = collectAllFiles();
    return NextResponse.json(files);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
