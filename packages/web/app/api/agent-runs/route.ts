export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleAgentRunsGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(req: Request) {
  const url = new URL(req.url);
  return toNextResponse(handleAgentRunsGet(url.searchParams, { mindRoot: getMindRoot() }));
}
