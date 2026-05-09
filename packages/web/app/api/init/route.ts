import { NextRequest } from 'next/server';
import { handleInitPost } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../_mindos-adapter';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return toNextResponse(handleInitPost(body, {
    mindRoot: getMindRoot(),
    projectRoot: process.env.MINDOS_PROJECT_ROOT,
  }));
}
