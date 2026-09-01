export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleUserQuestionDecisionPost, json } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return toNextResponse(body === null
    ? json({ error: 'Invalid request body.' }, { status: 400 })
    : handleUserQuestionDecisionPost(body));
}
