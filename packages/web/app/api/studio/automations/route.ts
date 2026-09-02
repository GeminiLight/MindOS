export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getMindRoot } from '@/lib/fs';
import {
  handleStudioAutomationsGet,
  handleStudioAutomationsPost,
  json,
} from '@geminilight/mindos/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

function services() {
  return {
    mindRoot: getMindRoot(),
    homeDir: process.env.MINDOS_STUDIO_AUTOMATION_HOME || process.env.HOME || process.env.USERPROFILE,
  };
}

export async function GET() {
  return toNextResponse(handleStudioAutomationsGet(services()));
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return toNextResponse(json({ error: 'invalid JSON' }, { status: 400 }));
    }

    return toNextResponse(handleStudioAutomationsPost(body, services()));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
