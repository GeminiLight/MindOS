export const dynamic = 'force-dynamic';

import { handleBacklinks } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { collectAllFiles, getFileContent } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

export function GET(req: NextRequest) {
  try {
    return toNextResponse(handleBacklinks(req.nextUrl.searchParams, {
      collectAllFiles,
      readTextFile: getFileContent,
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
