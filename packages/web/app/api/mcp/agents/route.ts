export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import os from 'os';
import path from 'path';
import {
  handleMcpAgentsGet,
  type MindosCustomMcpAgentDef,
  type MindosMcpAgentRegistryDef,
} from '@geminilight/mindos/server';
import {
  MCP_AGENTS,
  detectAgentConfiguredMcpServers,
  detectAgentInstalledSkills,
  detectAgentPresence,
  detectAgentRuntimeSignals,
  detectInstalled,
  resolveSkillWorkspaceProfile,
} from '@/lib/mcp-agents';
import { getAllAgents, loadCustomAgents, scanCustomAgentSkills } from '@/lib/custom-agents';
import { getMindRoot } from '@/lib/fs';
import { getProjectRoot } from '@/lib/project-root';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

export async function GET() {
  const projectRoot = getProjectRoot();
  const mindRoot = getMindRoot();
  const { loadSkills } = await import('@earendil-works/pi-coding-agent');

  return toNextResponse(await handleMcpAgentsGet({
    agents: getAllAgents() as Record<string, MindosMcpAgentRegistryDef>,
    builtInAgents: MCP_AGENTS as Record<string, MindosMcpAgentRegistryDef>,
    customAgents: loadCustomAgents() as MindosCustomMcpAgentDef[],
    readSettings,
    env: process.env,
    homeDir: os.homedir(),
    mindRoot,
    projectRoot,
    detectInstalled,
    detectAgentPresence,
    detectAgentRuntimeSignals,
    detectAgentConfiguredMcpServers,
    detectAgentInstalledSkills,
    resolveSkillWorkspaceProfile,
    scanCustomAgentSkills: scanCustomAgentSkills as (custom: MindosCustomMcpAgentDef) => ReturnType<typeof scanCustomAgentSkills>,
    loadMindosSkills: () => {
      const { skills } = loadSkills({
        cwd: projectRoot,
        agentDir: path.join(os.homedir(), '.pi'),
        skillPaths: [
          path.join(projectRoot, 'packages', 'web', 'data', 'skills'),
          path.join(projectRoot, 'skills'),
          path.join(mindRoot, '.skills'),
          path.join(os.homedir(), '.mindos', 'skills'),
        ],
        includeDefaults: false,
      });

      return {
        names: skills.map((skill) => skill.name),
        sourcePath: path.join(projectRoot, 'skills'),
        workspacePath: path.join(os.homedir(), '.agents', 'skills'),
      };
    },
  }));
}
