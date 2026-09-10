import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  A2aServices,
  AcpDetectServices,
  AcpRegistryServices,
  AcpSessionServices,
  AgentCapabilitiesServices,
  AgentRuntimesServices,
  MindosCustomMcpAgentDef,
  MindosHttpServices,
  MindosMcpAgentDef,
  MindosMcpAgentRegistryDef,
  MindosSkillAgentRegistration,
} from '@geminilight/mindos/server';
import * as a2aClient from '@/lib/a2a/client';
import { validateA2aDiscoveryUrl } from '@/lib/a2a/discovery-policy';
import * as a2aTasks from '@/lib/a2a/task-handler';
import * as acpDetect from '@/lib/acp/detect-local';
import * as acpRegistry from '@/lib/acp/registry';
import * as acpSession from '@/lib/acp/session';
import { expandHome } from '@geminilight/mindos/foundation';
import * as customAgents from '@/lib/custom-agents';
import { SKILL_AGENT_REGISTRY } from '@/lib/mcp-agent-registry';
import * as mcpAgents from '@/lib/mcp-agents';
import { getProjectRoot } from '@/lib/project-root';

type WebAgentServices = Pick<
  MindosHttpServices,
  'a2a' | 'acp' | 'agentRuntimes' | 'agentCapabilities' | 'mcpAgentServices' | 'skills'
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * Wraps a `@/lib` function so it is resolved on call, not when the services
 * object is built. Routes only touch the modules their handler needs, which
 * is what the per-route tests mock; and the cast lets the Web signature stand
 * in for the product's structurally compatible one.
 */
function deferred<F extends AnyFn>(get: () => AnyFn): F {
  return ((...args: unknown[]) => get()(...args)) as F;
}

/** Agent-facing capabilities the Web host owns: A2A registry, ACP session overrides, runtime detection, MCP agent registry, skills. */
export function createWebAgentServices(): WebAgentServices {
  return {
    a2a: {
      getDiscoveredAgents: deferred(() => a2aClient.getDiscoveredAgents),
      getDelegationHistory: deferred(() => a2aClient.getDelegationHistory),
      discoverAgent: deferred<NonNullable<A2aServices['discoverAgent']>>(() => a2aClient.discoverAgent),
      validateDiscoveryUrl: (url) => {
        const decision = validateA2aDiscoveryUrl(url);
        return decision.ok ? { ok: true, url: decision.url } : { ok: false, message: decision.message };
      },
      handleSendMessage: deferred<NonNullable<A2aServices['handleSendMessage']>>(() => a2aTasks.handleSendMessage),
      handleGetTask: deferred<NonNullable<A2aServices['handleGetTask']>>(() => a2aTasks.handleGetTask),
      handleCancelTask: deferred<NonNullable<A2aServices['handleCancelTask']>>(() => a2aTasks.handleCancelTask),
    },
    acp: {
      createSession: deferred<NonNullable<AcpSessionServices['createSession']>>(() => acpSession.createSession),
      loadSession: deferred<NonNullable<AcpSessionServices['loadSession']>>(() => acpSession.loadSession),
      listSessions: deferred<NonNullable<AcpSessionServices['listSessions']>>(() => acpSession.listSessions),
      listSessionsForAgent: deferred<NonNullable<AcpSessionServices['listSessionsForAgent']>>(() => acpSession.listSessionsForAgent),
      closeSession: deferred<NonNullable<AcpSessionServices['closeSession']>>(() => acpSession.closeSession),
      prompt: deferred<NonNullable<AcpSessionServices['prompt']>>(() => acpSession.prompt),
      cancelPrompt: deferred<NonNullable<AcpSessionServices['cancelPrompt']>>(() => acpSession.cancelPrompt),
      setMode: deferred<NonNullable<AcpSessionServices['setMode']>>(() => acpSession.setMode),
      setConfigOption: deferred<NonNullable<AcpSessionServices['setConfigOption']>>(() => acpSession.setConfigOption),
      getSession: deferred<NonNullable<AcpSessionServices['getSession']>>(() => acpSession.getSession),
      getActiveSessions: deferred<NonNullable<AcpSessionServices['getActiveSessions']>>(() => acpSession.getActiveSessions),
      getActiveSessionSnapshots: deferred(() => acpSession.getActiveSessionSnapshots),
      detectLocalAcpAgents: deferred<NonNullable<AcpDetectServices['detectLocalAcpAgents']>>(() => acpDetect.detectLocalAcpAgents),
      fetchAcpRegistry: deferred<NonNullable<AcpRegistryServices['fetchAcpRegistry']>>(() => acpRegistry.fetchAcpRegistry),
      findAcpAgent: deferred<NonNullable<AcpRegistryServices['findAcpAgent']>>(() => acpRegistry.findAcpAgent),
    },
    // The detectors below only wrap the product defaults through `@/lib/acp/detect-local`
    // (the seam the Web API tests mock), so every route bundle shares one detection-cache
    // bucket under a stable identity instead of probing once per bundle.
    agentRuntimes: {
      detectionIdentity: 'web-host',
      detectLocalAcpAgents: deferred<NonNullable<AgentRuntimesServices['detectLocalAcpAgents']>>(() => acpDetect.detectLocalAcpAgents),
      resolveRuntimeCommand: deferred<NonNullable<AgentRuntimesServices['resolveRuntimeCommand']>>(() => acpDetect.resolveCommandPath),
      resolveRuntimeCommandCandidates: deferred<NonNullable<AgentRuntimesServices['resolveRuntimeCommandCandidates']>>(() => acpDetect.resolveCommandPathCandidates),
      checkNativeRuntimeHealth: deferred<NonNullable<AgentRuntimesServices['checkNativeRuntimeHealth']>>(() => acpDetect.checkNativeRuntimeHealth),
    },
    agentCapabilities: createLazyAgentCapabilities(),
    mcpAgentServices: {
      // The Web UI must not write config into agents that are not installed on this machine.
      requireAgentPresence: true,
      get builtInAgents() {
        return mcpAgents.MCP_AGENTS as unknown as Record<string, MindosMcpAgentRegistryDef>;
      },
      get customAgents() {
        return customAgents.loadCustomAgents() as unknown as MindosCustomMcpAgentDef[];
      },
      detectInstalled: deferred(() => mcpAgents.detectInstalled),
      detectAgentPresence: detectAgentPresenceIncludingCustom,
      detectAgentRuntimeSignals: deferred(() => mcpAgents.detectAgentRuntimeSignals),
      detectAgentConfiguredMcpServers: deferred(() => mcpAgents.detectAgentConfiguredMcpServers),
      detectAgentInstalledSkills: deferred(() => mcpAgents.detectAgentInstalledSkills),
      resolveSkillWorkspaceProfile: deferred(() => mcpAgents.resolveSkillWorkspaceProfile),
      scanCustomAgentSkills: deferred(() => customAgents.scanCustomAgentSkills),
      get skillAgentRegistry() {
        return SKILL_AGENT_REGISTRY as unknown as Record<string, MindosSkillAgentRegistration>;
      },
      loadMindosSkills,
    },
    skills: {
      listLinkAgents: deferred(() => mcpAgents.listSkillLinkAgents),
      trustedNativeSkillRoots: getTrustedNativeSkillRoots,
    },
  };
}

/** Built-in plus user-defined MCP agents; read per request because custom agents live in settings. */
export function listWebMcpAgents(): Record<string, MindosMcpAgentDef> {
  return customAgents.getAllAgents() as unknown as Record<string, MindosMcpAgentDef>;
}

/** Built-ins use their registry probe; custom agents are present when any declared directory exists. */
function detectAgentPresenceIncludingCustom(agentKey: string): boolean {
  if (agentKey in mcpAgents.MCP_AGENTS) return mcpAgents.detectAgentPresence(agentKey);
  const agent = customAgents.getAllAgents()[agentKey] as { presenceDirs?: string[] } | undefined;
  return agent?.presenceDirs?.some((dir) => fs.existsSync(expandHome(dir))) ?? false;
}

/** Native skill directories `read-native` may read: every present built-in agent's workspace plus custom agents' skill dirs. */
function getTrustedNativeSkillRoots(): string[] {
  const roots = new Set<string>();
  for (const key of Object.keys(mcpAgents.MCP_AGENTS)) {
    const profile = mcpAgents.resolveSkillWorkspaceProfile(key);
    if (profile.workspacePath) roots.add(profile.workspacePath);
  }
  for (const custom of customAgents.loadCustomAgents()) {
    roots.add(expandHome(custom.skillDir || path.join(custom.baseDir, 'skills')));
  }
  return [...roots];
}

/**
 * MindOS's own skills as the MCP agent profile reports them. The pi skill
 * loader is imported on demand: it is the heaviest dependency behind
 * `/api/mcp/agents` and nothing else on the route table needs it.
 */
async function loadMindosSkills(): Promise<{ names: string[]; sourcePath: string; workspacePath: string }> {
  const { loadSkills } = await import('@earendil-works/pi-coding-agent');
  const projectRoot = getProjectRoot();
  const home = os.homedir();
  const mindRoot = (await import('@/lib/fs')).getMindRoot();
  const { skills } = loadSkills({
    cwd: projectRoot,
    agentDir: path.join(home, '.pi'),
    skillPaths: [
      path.join(projectRoot, 'packages', 'web', 'data', 'skills'),
      path.join(projectRoot, 'skills'),
      path.join(mindRoot, '.skills'),
      path.join(home, '.mindos', 'skills'),
    ],
    includeDefaults: false,
  });
  return {
    names: skills.map((skill) => skill.name),
    sourcePath: path.join(projectRoot, 'skills'),
    workspacePath: path.join(home, '.agents', 'skills'),
  };
}

/**
 * The capability registry pulls in the pi toolkit; loading it lazily keeps
 * every other route's module graph (and test) free of it. The registry is
 * built once per services object and reused across requests.
 */
function createLazyAgentCapabilities(): AgentCapabilitiesServices {
  let registry: Promise<AgentCapabilitiesServices> | undefined;
  const load = () => (registry ??= import('@/lib/agent/capability-registry').then((mod) => mod.createAgentCapabilitiesServices()));
  const source = (key: keyof AgentCapabilitiesServices) => async () => (await (await load())[key]?.()) ?? [];
  return {
    kb: source('kb'),
    subagents: source('subagents'),
    acp: source('acp'),
    native: source('native'),
    mcp: source('mcp'),
    a2a: source('a2a'),
  };
}
