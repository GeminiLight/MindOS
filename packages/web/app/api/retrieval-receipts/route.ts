export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleRetrievalReceiptsGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(request: Request) {
  return toNextResponse(await handleRetrievalReceiptsGet(new URL(request.url).searchParams, {
    mindRoot: getMindRoot(),
  }));
}
