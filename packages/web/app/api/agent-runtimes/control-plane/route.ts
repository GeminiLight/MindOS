export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  handleRuntimeControlPlaneGet,
  handleRuntimeControlPlanePost,
  json,
} from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

export async function GET(req: Request) {
  try {
    return toNextResponse(await handleRuntimeControlPlaneGet(new URL(req.url).searchParams, {
      mindRoot: getMindRoot(),
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return toNextResponse(json({ error: 'invalid JSON' }, { status: 400 }));
  }

  try {
    return toNextResponse(handleRuntimeControlPlanePost(body, {
      mindRoot: getMindRoot(),
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
