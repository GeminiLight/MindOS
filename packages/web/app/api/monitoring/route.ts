export const dynamic = 'force-dynamic';

import { handleMonitoringGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { metrics } from '@/lib/metrics';
import { toNextResponse } from '../_mindos-adapter';

export function GET() {
  return toNextResponse(handleMonitoringGet({
    mindRoot: getMindRoot(),
    metricsSnapshot: () => metrics.getSnapshot(),
  }));
}
