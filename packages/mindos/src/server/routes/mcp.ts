import { getLocalIPv4 } from '../handlers/connect.js';
import { handleMcpAgentsGet, type MindosMcpAgentRegistryDef, type MindosMcpAgentsServices } from '../handlers/mcp-agents.js';
import {
  handleMcpInstallPost,
  handleMcpServerCopyPost,
  handleMcpUninstallPost,
  type MindosMcpInstallRequest,
  type MindosMcpServerCopyRequest,
  type MindosMcpUninstallRequest,
} from '../handlers/mcp-install.js';
import { handleMcpInstallSkillPost, type MindosMcpInstallSkillRequest } from '../handlers/mcp-install-skill.js';
import { handleMcpRestartPost } from '../handlers/mcp-restart.js';
import { handleMcpStatus, handleMcpTokenReveal, type MindosMcpStatusServices, type MindosMcpStatusSettings } from '../handlers/mcp-status.js';
import { handleMcpDirectToolsPost, handleMcpToolsGet, type MindosMcpDirectToolsRequest } from '../handlers/mcp-tools.js';
import { createDefaultSkillAgentRegistry } from '../mcp-agent-registry.js';
import { defineRoutes } from '../route-table.js';
import type { MindosRuntimeSettings } from '../runtime.js';
import type { MindosHttpServices } from '../services.js';

export const mcpRoutes = defineRoutes([
  { id: 'mcp.status', method: 'GET', path: '/api/mcp/status', auth: 'required',
    handler: ({ headers, services }) => handleMcpStatus(createHttpMcpStatusServices(services), {
      host: headers.get('host') ?? undefined,
    }) },
  { id: 'mcp.token.reveal', method: 'POST', path: '/api/mcp/token/reveal', auth: 'required',
    handler: ({ services }) => handleMcpTokenReveal(createHttpMcpStatusServices(services)) },
  { id: 'mcp.agents', method: 'GET', path: '/api/mcp/agents', auth: 'required',
    handler: ({ services }) => handleMcpAgentsGet(createHttpMcpAgentsServices(services)) },
  { id: 'mcp.tools', method: 'GET', path: '/api/mcp/tools', auth: 'required',
    handler: ({ services }) => handleMcpToolsGet(services.mcpTools ?? {
      readMcpConfig: () => ({ mcpServers: {} }),
      readMcpToolCache: () => null,
    }) },
  { id: 'mcp.direct-tools', method: 'POST', path: '/api/mcp/direct-tools', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleMcpDirectToolsPost(
      await readJsonBody() as MindosMcpDirectToolsRequest,
      services.mcpTools ?? { updateServerDirectTools: () => {} },
    ) },
  { id: 'mcp.install', method: 'POST', path: '/api/mcp/install', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleMcpInstallPost(await readJsonBody() as MindosMcpInstallRequest, createHttpMcpInstallServices(services)) },
  { id: 'mcp.copy-server', method: 'POST', path: '/api/mcp/copy-server', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleMcpServerCopyPost(await readJsonBody() as MindosMcpServerCopyRequest, createHttpMcpInstallServices(services)) },
  { id: 'mcp.install-skill', method: 'POST', path: '/api/mcp/install-skill', auth: 'required',
    handler: async ({ readJsonBody, services, runtimeRoot }) => handleMcpInstallSkillPost(await readJsonBody() as MindosMcpInstallSkillRequest, {
      agents: (services.mcpAgents ?? {}) as Record<string, MindosMcpAgentRegistryDef>,
      skillAgentRegistry: services.mcpAgentServices?.skillAgentRegistry ?? createDefaultSkillAgentRegistry(),
      projectRoot: services.runtimeRoot ?? runtimeRoot ?? process.cwd(),
      cwd: services.runtimeRoot ?? runtimeRoot ?? process.cwd(),
      homeDir: services.homeDir,
      env: process.env,
    }) },
  { id: 'mcp.restart', method: 'POST', path: '/api/mcp/restart', auth: 'required',
    handler: ({ services }) => handleMcpRestartPost({
      readSettings: services.readSettings,
      env: process.env,
      projectRoot: services.runtimeRoot ?? process.cwd(),
      events: services.events,
    }) },
  { id: 'mcp.uninstall', method: 'POST', path: '/api/mcp/uninstall', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleMcpUninstallPost(await readJsonBody() as MindosMcpUninstallRequest, {
      agents: services.mcpAgents ?? {},
      events: services.events,
    }) },
]);

/**
 * Shared by GET /api/mcp/agents and the runtime projection services. Host
 * enrichers (`mcpAgentServices`: presence probes, installed-config detection,
 * custom agents, MindOS skill listing) layer over the product defaults.
 */
export function createHttpMcpAgentsServices(services: MindosHttpServices): MindosMcpAgentsServices {
  const { requireAgentPresence: _requireAgentPresence, ...host } = services.mcpAgentServices ?? {};
  return {
    agents: (services.mcpAgents ?? {}) as Record<string, MindosMcpAgentRegistryDef>,
    readSettings: services.readSettings,
    env: process.env,
    homeDir: services.homeDir,
    mindRoot: services.mindRoot,
    projectRoot: services.runtimeRoot ?? process.cwd(),
    skillAgentRegistry: createDefaultSkillAgentRegistry(),
    ...host,
  };
}

/** Install / copy write agent config files; a host may require the agent to be present before touching them. */
function createHttpMcpInstallServices(services: MindosHttpServices) {
  return {
    agents: services.mcpAgents ?? {},
    requireAgentPresence: services.mcpAgentServices?.requireAgentPresence,
    detectAgentPresence: services.mcpAgentServices?.detectAgentPresence,
    readSettings: services.readSettings,
    env: process.env,
    events: services.events,
  };
}

function createHttpMcpStatusServices(services: MindosHttpServices): MindosMcpStatusServices {
  return {
    env: process.env,
    readSettings: () => normalizeMcpStatusSettings(services.readSettings()),
    fetchHealth: fetchJsonHealth,
    getLocalIP: getLocalIPv4,
    maskToken,
  };
}

function normalizeMcpStatusSettings(settings: MindosRuntimeSettings): MindosMcpStatusSettings {
  const connectionMode = settings.connectionMode && typeof settings.connectionMode === 'object'
    ? settings.connectionMode as { cli?: unknown; mcp?: unknown }
    : undefined;
  return {
    mcpPort: typeof settings.mcpPort === 'number' ? settings.mcpPort : undefined,
    authToken: typeof settings.authToken === 'string' ? settings.authToken : undefined,
    connectionMode: typeof connectionMode?.cli === 'boolean' && typeof connectionMode.mcp === 'boolean'
      ? { cli: connectionMode.cli, mcp: connectionMode.mcp }
      : undefined,
  };
}

async function fetchJsonHealth(url: string, timeoutMs: number): Promise<{ ok: boolean; body?: { ok?: boolean; service?: string } }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => undefined) as { ok?: boolean; service?: string } | undefined;
    return { ok: response.ok, body };
  } finally {
    clearTimeout(timeout);
  }
}

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '***set***';
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}
