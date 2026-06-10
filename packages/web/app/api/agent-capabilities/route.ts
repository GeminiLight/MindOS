export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleAgentCapabilitiesGet } from '@geminilight/mindos/server';
import { createAgentCapabilitiesServices } from '@/lib/agent/capability-registry';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(req: Request) {
  return toNextResponse(await handleAgentCapabilitiesGet(
    new URL(req.url).searchParams,
    createAgentCapabilitiesServices(),
  ));
}
