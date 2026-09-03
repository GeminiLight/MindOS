export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { handleContextFeedbackGet, handleContextFeedbackPost } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(request: NextRequest) {
  return toNextResponse(await handleContextFeedbackGet(new URL(request.url).searchParams, { mindRoot: getMindRoot() }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return toNextResponse(await handleContextFeedbackPost(body, { mindRoot: getMindRoot() }));
}
