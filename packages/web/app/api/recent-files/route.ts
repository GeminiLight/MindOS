export const dynamic = 'force-dynamic';

import { handleRecentFiles } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { getRecentlyModified } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export function GET(req: NextRequest) {
  return toNextResponse(handleRecentFiles(req.nextUrl.searchParams, {
    getRecentlyModified,
  }));
}
