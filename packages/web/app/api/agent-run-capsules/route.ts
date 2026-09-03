export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleAgentRunCapsulesGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(req: Request) {
  return toNextResponse(handleAgentRunCapsulesGet(new URL(req.url).searchParams, { mindRoot: getMindRoot() }));
}
