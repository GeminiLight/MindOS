export const dynamic = 'force-dynamic';

import { handleGraph } from '@geminilight/mindos/server';
import { collectAllFiles, getFileContent } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';
export type { GraphData, GraphEdge, GraphNode } from '@geminilight/mindos/server';

export function GET() {
  try {
    return toNextResponse(handleGraph({
      collectAllFiles,
      readTextFile: getFileContent,
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
