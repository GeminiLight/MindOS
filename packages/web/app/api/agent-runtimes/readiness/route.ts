export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import os from 'os';
import {
  handleAgentRuntimeReadinessGet,
  handleAgentRuntimesGet,
  handleMcpAgentsGet,
  type AgentRuntimesServices,
  type MindosCustomMcpAgentDef,
  type MindosMcpAgentRegistryDef,
} from '@geminilight/mindos/server';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath, resolveCommandPathCandidates } from '@/lib/acp/detect-local';
import { getAllAgents, loadCustomAgents, scanCustomAgentSkills } from '@/lib/custom-agents';
import { getMindRoot } from '@/lib/fs';
import {
  MCP_AGENTS,
  detectAgentConfiguredMcpServers,
  detectAgentInstalledSkills,
  detectAgentPresence,
  detectAgentRuntimeSignals,
  detectInstalled,
  resolveSkillWorkspaceProfile,
} from '@/lib/mcp-agents';
import { readMcpConfig } from '@/lib/pi-integration/mcp-config';
import { getProjectRoot } from '@/lib/project-root';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

const runtimeServices: AgentRuntimesServices = {
  readSettings: readSettings as AgentRuntimesServices['readSettings'],
  detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
  resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
  resolveRuntimeCommandCandidates: resolveCommandPathCandidates as AgentRuntimesServices['resolveRuntimeCommandCandidates'],
  checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectRoot = getProjectRoot();
  const mindRoot = getMindRoot();

  return toNextResponse(await handleAgentRuntimeReadinessGet(url.searchParams, {
    listRuntimes: async () => {
      const runtimeParams = new URLSearchParams();
      if (url.searchParams.get('force') === '1') runtimeParams.set('force', '1');
      const response = await handleAgentRuntimesGet(runtimeParams, runtimeServices);
      if (response.status === 200 && response.body && 'runtimes' in response.body) return response.body.runtimes;
      throw new Error('Failed to build runtime descriptors for runtime readiness.');
    },
    listMcpAgents: async () => {
      const response = await handleMcpAgentsGet({
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
      });
      if (response.status === 200 && response.body && 'agents' in response.body) return response.body.agents;
      throw new Error('Failed to build MCP agent profiles for runtime readiness.');
    },
    readMcpConfig,
  }));
}
