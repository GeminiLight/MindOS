export const dynamic = 'force-dynamic';

import { handleGraph } from '@geminilight/mindos/server';
import { collectAllFiles, getFileContent, peekTreeVersion } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';
export type { GraphData, GraphEdge, GraphNode } from '@geminilight/mindos/server';

export function GET() {
  try {
    return toNextResponse(handleGraph({
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
