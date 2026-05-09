export const dynamic = 'force-dynamic';
import { handleFiles } from '@geminilight/mindos/server';
import { collectAllFiles } from '@/lib/fs';
import { NextRequest } from 'next/server';
import { toNextResponse } from '../_mindos-adapter';
import { handleRouteErrorSimple } from '@/lib/errors';

export async function GET(req: NextRequest) {
  try {
    return toNextResponse(handleFiles(req?.nextUrl?.searchParams, { collectAllFiles }));
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
