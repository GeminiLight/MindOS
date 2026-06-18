export const dynamic = 'force-dynamic';

import fs from 'fs';
import { NextRequest } from 'next/server';
import {
  handleMcpServerCopyPost,
  type MindosMcpAgentDef,
} from '@geminilight/mindos/server';
import { getAllAgents } from '@/lib/custom-agents';
import { detectAgentPresence, expandHome, MCP_AGENTS } from '@/lib/mcp-agents';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  const agents = getAllAgents() as unknown as Record<string, MindosMcpAgentDef & { presenceDirs?: string[] }>;

  return toNextResponse(await handleMcpServerCopyPost(await req.json(), {
    agents,
    requireAgentPresence: true,
    detectAgentPresence: (key) => {
      if (key in MCP_AGENTS) return detectAgentPresence(key);
      const agent = agents[key];
      return agent?.presenceDirs?.some((dir) => fs.existsSync(expandHome(dir))) ?? false;
    },
    readSettings,
    env: process.env,
  }));
}
