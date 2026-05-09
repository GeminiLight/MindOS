export const dynamic = 'force-dynamic';

import { handleSyncGet, handleSyncPost } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

export async function GET() {
  return toNextResponse(await handleSyncGet());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return toNextResponse(await handleSyncPost(body));
}
