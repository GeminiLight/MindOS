export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handlePendingAgentActionsGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../../_mindos-adapter';

export async function GET() {
  return toNextResponse(handlePendingAgentActionsGet({ mindRoot: getMindRoot() }));
}
