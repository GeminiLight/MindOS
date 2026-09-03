export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getMindRoot } from '@/lib/fs';
import {
  handleAutomationEventsGet,
  handleAutomationEventsPost,
  json,
} from '@geminilight/mindos/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

function services() {
  return { mindRoot: getMindRoot() };
}

export async function GET(req: Request) {
  return toNextResponse(handleAutomationEventsGet(new URL(req.url).searchParams, services()));
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return toNextResponse(json({ error: 'invalid JSON' }, { status: 400 }));
    }
    return toNextResponse(handleAutomationEventsPost(body, services()));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
