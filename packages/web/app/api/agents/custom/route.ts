export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import {
  handleCustomAgentsDelete,
  handleCustomAgentsPost,
  handleCustomAgentsPut,
  type CustomAgentSettings,
} from '@geminilight/mindos/server';
import { MCP_AGENTS } from '@/lib/mcp-agents';
import { readSettings, writeSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

const services = {
  readSettings: () => readSettings() as unknown as CustomAgentSettings,
  writeSettings: (settings: CustomAgentSettings) => writeSettings(settings as unknown as ReturnType<typeof readSettings>),
  builtInAgentKeys: Object.keys(MCP_AGENTS),
};

/** POST — Create a new custom agent. */
export async function POST(req: NextRequest) {
  return toNextResponse(handleCustomAgentsPost(await req.json(), services));
}

/** PUT — Update an existing custom agent. */
export async function PUT(req: NextRequest) {
  return toNextResponse(handleCustomAgentsPut(await req.json(), services));
}

/** DELETE — Remove a custom agent. */
export async function DELETE(req: NextRequest) {
  return toNextResponse(handleCustomAgentsDelete(await req.json(), services));
}
