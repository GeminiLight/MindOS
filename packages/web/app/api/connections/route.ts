import { NextRequest } from 'next/server';
import { handleConnectionsGet, handleConnectionsPost } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(req: NextRequest) {
  return toNextResponse(await handleConnectionsGet(new URL(req.url).searchParams, { mindRoot: getMindRoot() }));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return toNextResponse(await handleConnectionsPost(body, { mindRoot: getMindRoot() }));
}
