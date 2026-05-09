export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import {
  handleMcpInstallPost,
  type MindosMcpAgentDef,
  type MindosSkillAgentRegistration,
} from '@geminilight/mindos/server';
import { MCP_AGENTS, SKILL_AGENT_REGISTRY, resolveSkillWorkspaceProfile } from '@/lib/mcp-agents';
import { readSettings, recordSkillInstall } from '@/lib/settings';
import { copyDir, dirExists } from '@/lib/file-ops';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  return toNextResponse(await handleMcpInstallPost(await req.json(), {
    agents: MCP_AGENTS as unknown as Record<string, MindosMcpAgentDef>,
    skillAgentRegistry: SKILL_AGENT_REGISTRY as unknown as Record<string, MindosSkillAgentRegistration>,
    readSettings,
    recordSkillInstall,
    resolveSkillWorkspaceProfile,
    copyDirectory: copyDir,
    directoryExists: dirExists,
    projectRoot: getProjectRoot(),
    env: process.env,
  }));
}
