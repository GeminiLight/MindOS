export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleAgentRunCapsuleRecoveryPost } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../../../_mindos-adapter';

type RouteContext = {
  params: Promise<{ capsuleId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const { capsuleId } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  return toNextResponse(handleAgentRunCapsuleRecoveryPost(capsuleId, body, { mindRoot: getMindRoot() }));
}
