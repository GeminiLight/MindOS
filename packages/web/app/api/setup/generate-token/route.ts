export const dynamic = 'force-dynamic';

import { handleSetupGenerateToken } from '@geminilight/mindos/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: Request) {
  try {
    return toNextResponse(handleSetupGenerateToken(await req.json().catch(() => ({}))));
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
