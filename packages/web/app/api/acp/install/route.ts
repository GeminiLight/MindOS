export const dynamic = 'force-dynamic';

import { handleAcpInstallPost } from '@geminilight/mindos/server';
import { toNextResponse } from '../../_mindos-adapter';

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  return toNextResponse(await handleAcpInstallPost(await readJson(req)));
}
