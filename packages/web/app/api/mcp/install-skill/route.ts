export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import os from 'os';
import {
  handleMcpInstallSkillPost,
  type MindosMcpAgentRegistryDef,
  type MindosSkillAgentRegistration,
} from '@geminilight/mindos/server';
import { SKILL_AGENT_REGISTRY } from '@/lib/mcp-agents';
import { getAllAgents } from '@/lib/custom-agents';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  return toNextResponse(handleMcpInstallSkillPost(await req.json().catch(() => ({})), {
    skillAgentRegistry: SKILL_AGENT_REGISTRY as unknown as Record<string, MindosSkillAgentRegistration>,
    agents: getAllAgents() as unknown as Record<string, MindosMcpAgentRegistryDef>,
    projectRoot: getProjectRoot(),
    cwd: process.cwd(),
    homeDir: os.homedir(),
    env: process.env,
  }));
}
