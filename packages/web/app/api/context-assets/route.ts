export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleContextAssetsGet } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(request: Request) {
  return toNextResponse(await handleContextAssetsGet(new URL(request.url).searchParams, {
    mindRoot: getMindRoot(),
  }));
}
