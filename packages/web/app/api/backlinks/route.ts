export const dynamic = 'force-dynamic';

import { handleBacklinks } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { collectAllFiles, getFileContent, peekTreeVersion } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

export function GET(req: NextRequest) {
  try {
    return toNextResponse(handleBacklinks(req.nextUrl.searchParams, {
      collectAllFiles,
      readTextFile: getFileContent,
      // Stable function reference → the handler's link-index snapshot caches
      // across requests and only rebuilds when the tree version changes.
      getTreeVersion: peekTreeVersion,
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
