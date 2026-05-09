export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import {
  handleMcpUninstallPost,
  type MindosMcpAgentDef,
} from '@geminilight/mindos/server';
import { MCP_AGENTS } from '@/lib/mcp-agents';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  return toNextResponse(handleMcpUninstallPost(await req.json(), {
    agents: MCP_AGENTS as unknown as Record<string, MindosMcpAgentDef>,
  }));
}
