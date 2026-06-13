export const dynamic = 'force-dynamic';

import { handleMonitoringGet } from '@geminilight/mindos/server';
import { getMindRoot, peekTreeVersion } from '@/lib/fs';
import { metrics } from '@/lib/metrics';
import { toNextResponse } from '../_mindos-adapter';

export function GET() {
  return toNextResponse(handleMonitoringGet({
    mindRoot: getMindRoot(),
    metricsSnapshot: () => metrics.getSnapshot(),
    // Tree-version key lets the handler reuse its knowledge-base stats walk
    // until the library actually changes.
    getTreeVersion: peekTreeVersion,
  }));
}
