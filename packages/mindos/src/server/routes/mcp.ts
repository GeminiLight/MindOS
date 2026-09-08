import { getLocalIPv4 } from '../handlers/connect.js';
import { handleMcpAgentsGet, type MindosMcpAgentRegistryDef } from '../handlers/mcp-agents.js';
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
    handler: async ({ readJsonBody, services }) => handleMcpInstallPost(await readJsonBody() as MindosMcpInstallRequest, {
      agents: services.mcpAgents ?? {},
      readSettings: services.readSettings,
      env: process.env,
      events: services.events,
    }) },
  { id: 'mcp.copy-server', method: 'POST', path: '/api/mcp/copy-server', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleMcpServerCopyPost(await readJsonBody() as MindosMcpServerCopyRequest, {
      agents: services.mcpAgents ?? {},
      readSettings: services.readSettings,
      env: process.env,
      events: services.events,
    }) },
  { id: 'mcp.install-skill', method: 'POST', path: '/api/mcp/install-skill', auth: 'required',
    handler: async ({ readJsonBody, services, runtimeRoot }) => handleMcpInstallSkillPost(await readJsonBody() as MindosMcpInstallSkillRequest, {
      agents: (services.mcpAgents ?? {}) as Record<string, MindosMcpAgentRegistryDef>,
      skillAgentRegistry: createDefaultSkillAgentRegistry(),
      projectRoot: services.runtimeRoot ?? runtimeRoot ?? process.cwd(),
      cwd: services.runtimeRoot ?? runtimeRoot ?? process.cwd(),
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

/** Shared by GET /api/mcp/agents and the runtime projection services. */
export function createHttpMcpAgentsServices(services: MindosHttpServices) {
  return {
    agents: (services.mcpAgents ?? {}) as Record<string, MindosMcpAgentRegistryDef>,
    readSettings: services.readSettings,
    env: process.env,
    mindRoot: services.mindRoot,
    projectRoot: services.runtimeRoot ?? process.cwd(),
    skillAgentRegistry: createDefaultSkillAgentRegistry(),
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
