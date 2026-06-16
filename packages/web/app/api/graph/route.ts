export const dynamic = 'force-dynamic';

import { handleGraph } from '@geminilight/mindos/server';
import { collectAllFiles, getFileContent, peekTreeVersion } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';
import type { NextRequest } from 'next/server';
export type { GraphData, GraphDirection, GraphEdge, GraphNode, GraphScope, GraphStats } from '@geminilight/mindos/server';

export function GET(req: NextRequest) {
  try {
    return toNextResponse(handleGraph(req.nextUrl.searchParams, {
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
