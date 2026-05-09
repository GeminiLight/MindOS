export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { handleCustomAgentDetectPost } from '@geminilight/mindos/server';
import { toNextResponse } from '../../../_mindos-adapter';

/** POST — Auto-detect config files in a baseDir. */
export async function POST(req: NextRequest) {
  return toNextResponse(handleCustomAgentDetectPost(await req.json()));
}
