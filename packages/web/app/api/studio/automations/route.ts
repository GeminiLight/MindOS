export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getMindRoot } from '@/lib/fs';
import {
  handleStudioAutomationsGet,
  handleStudioAutomationsPost,
  json,
} from '@geminilight/mindos/server';
import { runStudioAutomationWorkerTick } from '@/lib/studio-automation-worker';
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

    let result = handleStudioAutomationsPost(body, services());
    if (isRunNow(body) && result.status === 202) {
      void runStudioAutomationWorkerTick({ mindRoot: getMindRoot() }).catch(() => {
        console.warn('[studio-automation] Run-now worker tick failed; the durable queue will retry.');
      });
      result = handleStudioAutomationsGet(services());
    }
    return toNextResponse(result);
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

function isRunNow(body: unknown): boolean {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && (body as { action?: unknown }).action === 'run-now';
}
