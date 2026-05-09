import { handleTreeVersion } from '@geminilight/mindos/server';
import { getTreeVersion } from '@/lib/fs';
import { telemetry } from '@/lib/telemetry';
import { toNextResponse } from '../_mindos-adapter';

export const dynamic = 'force-dynamic';

export function GET() {
  const stop = telemetry.startTimer('tree.version.route');
  const v = getTreeVersion();
  const response = handleTreeVersion({ getTreeVersion: () => v });
  stop({ version: v });
  return toNextResponse(response);
}
