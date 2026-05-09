export const dynamic = 'force-dynamic';

import { handleChangesGet, handleChangesPost } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(req: NextRequest) {
  try {
    return toNextResponse(await handleChangesGet(req.nextUrl.searchParams, {
      mindRoot: getMindRoot(),
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }

  try {
    return toNextResponse(await handleChangesPost(body, {
      mindRoot: getMindRoot(),
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
