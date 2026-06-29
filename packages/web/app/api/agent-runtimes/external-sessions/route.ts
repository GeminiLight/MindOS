export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { listExternalRuntimeSessions } from '@/lib/server/runtime-session-importers';
import { toNextResponse } from '../../_mindos-adapter';

function readPositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(req: Request) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const runtimeId = searchParams.get('runtimeId')?.trim();
    if (!runtimeId) {
      return toNextResponse({ status: 400, body: { error: 'runtimeId is required' } });
    }

    const sessions = await listExternalRuntimeSessions({
      runtimeId,
      cwd: searchParams.get('cwd')?.trim() || undefined,
      sessionId: searchParams.get('sessionId')?.trim() || undefined,
      limit: readPositiveInteger(searchParams.get('limit')),
    });
    return toNextResponse({
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: { sessions },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    return toNextResponse({ status: 500, body: { error: message } });
  }
}
