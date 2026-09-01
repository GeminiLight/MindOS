export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handlePendingAgentActionsGet } from '@geminilight/mindos/server';
import { toNextResponse } from '../../_mindos-adapter';

export async function GET() {
  return toNextResponse(handlePendingAgentActionsGet());
}
