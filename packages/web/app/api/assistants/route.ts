export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleRouteErrorSimple } from '@/lib/errors';
import { getMindRoot } from '@/lib/fs';
import { ensureDefaultMindSystemUpgrade } from '@/lib/mind-system-upgrade';
import { toNextResponse } from '../_mindos-adapter';

type AssistantsServerResponse = Parameters<typeof toNextResponse>[0];
type AssistantsServices = { mindRoot: string };

type AssistantsServerModule = {
  handleAssistantsGet: (services: AssistantsServices) => AssistantsServerResponse;
  handleAssistantsPost: (body: unknown, services: AssistantsServices) => AssistantsServerResponse;
  handleAssistantsDelete: (body: unknown, services: AssistantsServices) => AssistantsServerResponse;
};

async function loadAssistantsServerModule(): Promise<AssistantsServerModule> {
  return await import(
    /* webpackIgnore: true */
    '@geminilight/mindos/server'
  ) as unknown as AssistantsServerModule;
}

export async function GET() {
  try {
    const mindRoot = getMindRoot();
    const { handleAssistantsGet } = await loadAssistantsServerModule();
    try {
      ensureDefaultMindSystemUpgrade(mindRoot);
    } catch (error) {
      console.warn('[assistants.route] default assistant upgrade skipped:', (error as Error).message);
    }
    return toNextResponse(handleAssistantsGet({ mindRoot }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function POST(req: Request) {
  const body = await readJsonBody(req);

  try {
    const mindRoot = getMindRoot();
    const { handleAssistantsPost } = await loadAssistantsServerModule();
    return toNextResponse(handleAssistantsPost(body, { mindRoot }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function DELETE(req: Request) {
  const body = await readJsonBody(req);

  try {
    const mindRoot = getMindRoot();
    const { handleAssistantsDelete } = await loadAssistantsServerModule();
    return toNextResponse(handleAssistantsDelete(body, { mindRoot }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
