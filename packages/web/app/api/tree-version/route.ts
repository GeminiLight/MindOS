export const dynamic = 'force-dynamic';
import { invalidateCache } from '@/lib/fs';
import { telemetry } from '@/lib/telemetry';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/tree-version');

/** Force a cache rebuild before answering; not part of the Product Server contract. */
export async function POST() {
  const stop = telemetry.startTimer('tree.version.refresh');
  invalidateCache();
  const response = await GET();
  stop({ status: response.status });
  return response;
}
