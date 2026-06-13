export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import {
  handleMcpInstallPost,
  type MindosMcpAgentDef,
} from '@geminilight/mindos/server';
import { MCP_AGENTS, detectAgentPresence } from '@/lib/mcp-agents';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  return toNextResponse(await handleMcpInstallPost(await req.json(), {
    agents: MCP_AGENTS as unknown as Record<string, MindosMcpAgentDef>,
    requireAgentPresence: true,
    detectAgentPresence,
    readSettings,
    env: process.env,
  }));
}
