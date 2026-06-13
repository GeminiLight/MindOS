import { handleTreeVersion } from '@geminilight/mindos/server';
import { getTreeVersion, invalidateCache } from '@/lib/fs';
import { telemetry } from '@/lib/telemetry';
import { toNextResponse } from '../_mindos-adapter';

export const dynamic = 'force-dynamic';

export function GET() {
  const stop = telemetry.startTimer('tree.version.route');
  const response = handleTreeVersion({ getTreeVersion });
  stop({ version: response.body?.v ?? -1 });
  return toNextResponse(response);
}

export function POST() {
  const stop = telemetry.startTimer('tree.version.refresh');
  invalidateCache();
  const response = handleTreeVersion({ getTreeVersion });
  stop({ version: response.body?.v ?? -1 });
  return toNextResponse(response);
}
