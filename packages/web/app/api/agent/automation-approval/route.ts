export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getMindRoot } from '@/lib/fs';
import { handleAutomationApprovalDecisionPost, json } from '@geminilight/mindos/server';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return toNextResponse(body === null
    ? json({ error: 'Invalid request body.' }, { status: 400 })
    : handleAutomationApprovalDecisionPost(body, { mindRoot: getMindRoot() }));
}
