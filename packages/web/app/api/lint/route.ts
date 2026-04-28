export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getMindRoot } from '@/lib/fs';
import { runLint } from '@/lib/lint';
import { handleRouteErrorSimple } from '@/lib/errors';

// GET /api/lint?space=Projects
export async function GET(req: NextRequest) {
  try {
    const space = req.nextUrl.searchParams.get('space') ?? undefined;
    const mindRoot = getMindRoot();
    const report = runLint(mindRoot, space);
    return NextResponse.json(report);
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
