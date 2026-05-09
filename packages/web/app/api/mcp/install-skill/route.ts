export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import {
  handleMcpInstallSkillPost,
  type MindosSkillAgentRegistration,
} from '@geminilight/mindos/server';
import { SKILL_AGENT_REGISTRY } from '@/lib/mcp-agents';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  return toNextResponse(handleMcpInstallSkillPost(await req.json().catch(() => ({})), {
    skillAgentRegistry: SKILL_AGENT_REGISTRY as unknown as Record<string, MindosSkillAgentRegistration>,
    projectRoot: getProjectRoot(),
    cwd: process.cwd(),
    env: process.env,
  }));
}
