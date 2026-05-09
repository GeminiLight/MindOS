export const dynamic = 'force-dynamic';

import { handleChannelsVerifyPost } from '@geminilight/mindos/server';
import { verifyIMCredentials } from '@/lib/im/verify';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return toNextResponse(await handleChannelsVerifyPost(body, {
    verifyCredentials: verifyIMCredentials,
  }));
}
