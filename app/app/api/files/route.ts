import { collectAllFiles } from '@/lib/fs';
import { NextResponse } from 'next/server';

export async function GET() {
  const files = collectAllFiles();
  return NextResponse.json(files);
}
