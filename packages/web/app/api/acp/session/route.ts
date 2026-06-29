export const dynamic = 'force-dynamic';

import {
  handleAcpSessionDelete,
  handleAcpSessionGet,
  handleAcpSessionPost,
  type AcpSessionServices,
} from '@geminilight/mindos/server';
import {
  createSession,
  loadSession,
  listSessions,
  listSessionsForAgent,
  closeSession,
  prompt,
  cancelPrompt,
  setMode,
  setConfigOption,
  getSession,
  getActiveSessions,
} from '@/lib/acp/session';
import { toNextResponse } from '../../_mindos-adapter';

const services: AcpSessionServices = {
  createSession: createSession as AcpSessionServices['createSession'],
  loadSession: loadSession as AcpSessionServices['loadSession'],
  listSessions: listSessions as AcpSessionServices['listSessions'],
  listSessionsForAgent: listSessionsForAgent as AcpSessionServices['listSessionsForAgent'],
  closeSession: closeSession as AcpSessionServices['closeSession'],
  prompt: prompt as AcpSessionServices['prompt'],
  cancelPrompt: cancelPrompt as AcpSessionServices['cancelPrompt'],
  setMode: setMode as AcpSessionServices['setMode'],
  setConfigOption: setConfigOption as AcpSessionServices['setConfigOption'],
  getSession: getSession as AcpSessionServices['getSession'],
  getActiveSessions: getActiveSessions as AcpSessionServices['getActiveSessions'],
};

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function GET() {
  return toNextResponse(handleAcpSessionGet(services));
}

export async function POST(req: Request) {
  return toNextResponse(await handleAcpSessionPost(await readJson(req), services));
}

export async function DELETE(req: Request) {
  return toNextResponse(await handleAcpSessionDelete(await readJson(req), services));
}
