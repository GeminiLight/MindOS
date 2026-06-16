// Sunk from packages/web/lib/agent/capability-registry.ts (Wave 3,
// spec-agent-core-consolidation). Maps the host's agent surface (KB tools,
// pi-subagents on disk, native/ACP runtimes, MCP tool cache, A2A registry)
// into AgentCapabilityInput records for the /api/agent/capabilities handler.
// ACP/A2A/MCP probing and settings IO stay services-injected — only the
// mapping rules and pi-subagent frontmatter discovery live here.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  handleAgentRuntimesGet,
  type AgentRuntimeDescriptor,
  type AgentRuntimesPayload,
  type AgentRuntimesServices,
} from '../../server/handlers/agent-runtimes.js';
import type {
  AgentCapabilitiesServices,
  AgentCapabilityInput,
} from '../../server/handlers/agent-capabilities.js';
import {
  MINDOS_READONLY_KB_TOOL_NAMES,
  MINDOS_ORGANIZE_KB_TOOL_NAMES,
} from './permission-policy.js';
import type { MindosAgentTool } from './kb-tools.js';

type PiSubagentModule = {
  name: string;
  localName?: string;
  description: string;
  source: 'builtin' | 'user' | 'project';
  filePath: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  maxExecutionTimeMs?: number;
  maxTokens?: number;
  interactive?: boolean;
  disabled?: boolean;
};

/** Structural shape of the host's MCP server config. */
export type MindosMcpConfigLike = {
  // directTools is boolean or an allowlist of tool names in the web config.
  mcpServers?: Record<string, {
    directTools?: boolean | string[];
    lifecycle?: string;
    mindosAgent?: MindosMcpServerAccess;
    mindos?: {
      agent?: MindosMcpServerAccess;
      [key: string]: unknown;
    };
  }>;
  settings?: {
    mindosAgent?: {
      mcpServers?: Record<string, MindosMcpServerAccess>;
    };
  };
};

export type MindosMcpServerAccess =
  | boolean
  | string[]
  | {
    enabled?: boolean;
    tools?: true | string[];
    directTools?: true | string[];
  };

/** Structural shape of the host's cached MCP tool listings. */
export type MindosMcpToolCacheLike =
  | Record<string, { tools?: Array<{ name: string; description?: string }> } | undefined>
  | null
  | undefined;

/** Structural shape of a discovered A2A agent. */
export type MindosA2aDiscoveredAgentLike = {
  id: string;
  endpoint: string;
  reachable: boolean;
  discoveredAt: unknown;
  card: {
    name: string;
    description: string;
    defaultInputModes: unknown;
    defaultOutputModes: unknown;
    capabilities: { streaming: unknown };
    provider: unknown;
    skills: Array<{ id: string; name: string; description: string; tags?: unknown }>;
  };
};

export interface MindosAgentCapabilityRegistryServices {
  /** The host's full KB tool array (MindosKbToolkit.knowledgeBaseTools). */
  knowledgeBaseTools: MindosAgentTool[];
  effectiveMindRoot(): string;
  readSettings: AgentRuntimesServices['readSettings'];
  detectLocalAcpAgents: AgentRuntimesServices['detectLocalAcpAgents'];
  resolveRuntimeCommand: AgentRuntimesServices['resolveRuntimeCommand'];
  checkNativeRuntimeHealth: AgentRuntimesServices['checkNativeRuntimeHealth'];
  readMcpConfig(): MindosMcpConfigLike;
  readMcpToolCache(): MindosMcpToolCacheLike;
  getDiscoveredAgents(): MindosA2aDiscoveredAgentLike[];
  /**
   * Locate the bundled pi-subagents agents directory (host install layout
   * specific — e.g. packages/web/node_modules/pi-subagents/agents). Return
   * null when not installed; builtin subagents are then skipped.
   */
  resolveBuiltinSubagentsDir?(): string | null;
}

const READONLY_KB_TOOL_NAMES = new Set<string>(MINDOS_READONLY_KB_TOOL_NAMES);
const ORGANIZE_KB_TOOL_NAMES = new Set<string>(MINDOS_ORGANIZE_KB_TOOL_NAMES);

export function createAgentCapabilitiesServices(
  services: MindosAgentCapabilityRegistryServices,
): AgentCapabilitiesServices {
  return {
    kb: () => listKnowledgeToolCapabilities(services),
    subagents: () => listPiSubagentCapabilities(services),
    native: () => listNativeRuntimeCapabilities(services),
    acp: () => listAcpRuntimeCapabilities(services),
    mcp: () => listMcpToolCapabilities(services),
    a2a: () => listA2aAgentCapabilities(services),
  };
}

function listKnowledgeToolCapabilities(services: MindosAgentCapabilityRegistryServices): AgentCapabilityInput[] {
  return services.knowledgeBaseTools.map((tool): AgentCapabilityInput => {
    const permissionRequired = permissionForKbTool(tool.name);
    return {
      id: `kb-tool:${tool.name}`,
      kind: 'kb-tool',
      name: tool.label || tool.name,
      description: tool.description,
      source: 'mindos',
      status: 'available',
      permissionRequired,
      availableInModes: modesForPermission(permissionRequired),
      inputKinds: ['json'],
      outputKinds: ['text'],
      supportsStreaming: false,
      supportsCancel: false,
      supportsBackgroundRuns: false,
      // KB writes are bounded by mode policy, protected-path guards, and the
      // audit log. They do not currently trigger an interactive approval card.
      supportsApprovals: false,
      supportsUserInput: false,
      defaultTimeoutMs: 30_000,
      metadata: {
        toolName: tool.name,
        schema: tool.parameters,
      },
    };
  });
}

async function listPiSubagentCapabilities(services: MindosAgentCapabilityRegistryServices): Promise<AgentCapabilityInput[]> {
  const agents = discoverPiSubagents(services.effectiveMindRoot(), services.resolveBuiltinSubagentsDir)
    .filter((agent) => agent.disabled !== true);

  return agents.map((agent) => ({
    id: `pi-subagent:${agent.source}:${agent.name}`,
    kind: 'pi-subagent',
    name: agent.localName || agent.name,
    description: agent.description || '',
    source: 'pi-subagents',
    status: 'available',
    permissionRequired: 'agent',
    availableInModes: ['agent'],
    inputKinds: ['text', 'files', 'context'],
    outputKinds: ['text', 'structured'],
    supportsStreaming: true,
    supportsCancel: true,
    supportsBackgroundRuns: true,
    supportsApprovals: false,
    supportsUserInput: Boolean(agent.interactive),
    defaultTimeoutMs: typeof agent.maxExecutionTimeMs === 'number' && Number.isFinite(agent.maxExecutionTimeMs)
      ? agent.maxExecutionTimeMs
      : 120_000,
    metadata: {
      agentId: agent.name,
      source: agent.source,
      sourcePath: agent.filePath,
      tools: agent.tools,
      skills: agent.skills,
      model: agent.model,
      maxTokens: agent.maxTokens,
    },
  }));
}

async function listNativeRuntimeCapabilities(services: MindosAgentCapabilityRegistryServices): Promise<AgentCapabilityInput[]> {
  const runtimes = await loadRuntimeDescriptors(services);
  return runtimes
    .filter((runtime) => runtime.kind === 'codex' || runtime.kind === 'claude' || runtime.kind === 'mindos')
    .map(runtimeToCapability);
}

async function listAcpRuntimeCapabilities(services: MindosAgentCapabilityRegistryServices): Promise<AgentCapabilityInput[]> {
  const runtimes = await loadRuntimeDescriptors(services);
  return runtimes
    .filter((runtime) => runtime.kind === 'acp')
    .map(runtimeToCapability);
}

function listMcpToolCapabilities(services: MindosAgentCapabilityRegistryServices): AgentCapabilityInput[] {
  const config = services.readMcpConfig();
  const cache = services.readMcpToolCache();
  const globalAllowlist = config.settings?.mindosAgent?.mcpServers ?? {};
  return Object.entries(config.mcpServers ?? {}).flatMap(([serverName, entry]) => {
    const access = resolveMindosAgentMcpAccess(serverName, entry, globalAllowlist);
    if (!access) return [];
    const serverCache = cache?.[serverName];
    const tools = filterMcpToolsForMindosAgent(serverCache?.tools ?? [], access);
    return tools.map((tool) => ({
      id: `mcp-tool:${serverName}:${tool.name}`,
      kind: 'mcp-tool',
      name: tool.name,
      description: tool.description ?? '',
      source: 'mcp',
      status: serverCache ? 'cached' : 'available',
      permissionRequired: 'agent',
      availableInModes: ['agent'],
      inputKinds: ['json'],
      outputKinds: ['text', 'structured'],
      supportsStreaming: false,
      supportsCancel: true,
      supportsBackgroundRuns: false,
      supportsApprovals: true,
      supportsUserInput: false,
      defaultTimeoutMs: 30_000,
      metadata: {
        serverName,
        toolName: tool.name,
        directTools: access,
        lifecycle: entry.lifecycle ?? 'lazy',
        cached: Boolean(serverCache),
      },
    }));
  });
}

function resolveMindosAgentMcpAccess(
  serverName: string,
  entry: NonNullable<MindosMcpConfigLike['mcpServers']>[string],
  globalAllowlist: Record<string, MindosMcpServerAccess>,
): true | string[] | null {
  return normalizeMindosMcpAccess(globalAllowlist[serverName])
    ?? normalizeMindosMcpAccess(entry.mindosAgent)
    ?? normalizeMindosMcpAccess(entry.mindos?.agent)
    ?? null;
}

function normalizeMindosMcpAccess(access: MindosMcpServerAccess | undefined): true | string[] | null {
  if (access === true) return true;
  if (access === false || access === undefined) return null;
  if (Array.isArray(access)) return normalizeToolNames(access);
  if (!access || typeof access !== 'object') return null;
  if (access.enabled === false) return null;
  if (access.tools === true || access.directTools === true) return true;
  if (Array.isArray(access.tools)) return normalizeToolNames(access.tools);
  if (Array.isArray(access.directTools)) return normalizeToolNames(access.directTools);
  if (access.enabled === true) return true;
  return null;
}

function normalizeToolNames(tools: string[]): string[] | null {
  const normalized = Array.from(new Set(tools.map((tool) => tool.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : null;
}

function filterMcpToolsForMindosAgent(
  tools: Array<{ name: string; description?: string }>,
  access: true | string[],
): Array<{ name: string; description?: string }> {
  if (access === true) return tools;
  const allowed = new Set(access);
  return tools.filter((tool) => allowed.has(tool.name));
}

function listA2aAgentCapabilities(services: MindosAgentCapabilityRegistryServices): AgentCapabilityInput[] {
  return services.getDiscoveredAgents().map((agent) => ({
    id: `a2a-agent:${agent.id}`,
    kind: 'a2a-agent',
    name: agent.card.name,
    description: agent.card.description,
    source: 'a2a',
    status: agent.reachable ? 'available' : 'error',
    permissionRequired: 'agent',
    availableInModes: ['agent'],
    inputKinds: agent.card.defaultInputModes,
    outputKinds: agent.card.defaultOutputModes,
    supportsStreaming: agent.card.capabilities.streaming,
    supportsCancel: true,
    supportsBackgroundRuns: true,
    supportsApprovals: false,
    supportsUserInput: true,
    defaultTimeoutMs: 30_000,
    metadata: {
      agentId: agent.id,
      endpoint: agent.endpoint,
      provider: agent.card.provider,
      skills: agent.card.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
      })),
      discoveredAt: agent.discoveredAt,
    },
  }));
}

async function loadRuntimeDescriptors(services: MindosAgentCapabilityRegistryServices): Promise<AgentRuntimeDescriptor[]> {
  const runtimeServices: AgentRuntimesServices = {
    readSettings: services.readSettings,
    detectLocalAcpAgents: services.detectLocalAcpAgents,
    resolveRuntimeCommand: services.resolveRuntimeCommand,
    checkNativeRuntimeHealth: services.checkNativeRuntimeHealth,
  };
  const response = await handleAgentRuntimesGet(new URLSearchParams(), {
    ...runtimeServices,
  });
  if (response.status !== 200 || !response.body || !('runtimes' in response.body)) {
    throw new Error('Could not load agent runtime descriptors.');
  }
  return (response.body as AgentRuntimesPayload).runtimes;
}

function runtimeToCapability(runtime: AgentRuntimeDescriptor): AgentCapabilityInput {
  return {
    id: `native-runtime:${runtime.kind}:${runtime.id}`,
    kind: runtime.kind === 'acp' ? 'acp-agent' : 'native-runtime',
    name: runtime.name,
    description: runtime.description ?? '',
    source: runtime.kind === 'acp' ? 'acp' : 'native',
    status: runtime.status === 'available'
      ? 'available'
      : runtime.status === 'missing'
        ? 'missing'
        : 'error',
    permissionRequired: runtime.kind === 'mindos' ? 'readonly' : 'agent',
    availableInModes: runtime.kind === 'mindos' ? modesForPermission('readonly') : ['agent'],
    inputKinds: ['text', 'files', 'context'],
    outputKinds: ['text', 'tool-events'],
    supportsStreaming: true,
    supportsCancel: runtime.capabilities.supportsInterrupt,
    supportsBackgroundRuns: runtime.capabilities.supportsBackgroundRuns,
    supportsApprovals: runtime.capabilities.supportsApprovals,
    supportsUserInput: runtime.capabilities.supportsUserInput,
    defaultTimeoutMs: 120_000,
    metadata: {
      runtimeKind: runtime.kind,
      runtimeId: runtime.id,
      adapter: runtime.adapter,
      aliases: runtime.aliases,
      sourceAgentId: runtime.sourceAgentId,
      canonicalAgentId: runtime.canonicalAgentId,
      mcpAgentKey: runtime.mcpAgentKey,
      capabilities: runtime.capabilities,
      availability: runtime.availability,
      binaryPath: runtime.binaryPath?.startsWith('sdk:') ? runtime.binaryPath : undefined,
      installCmd: runtime.installCmd,
      packageName: runtime.packageName,
    },
  };
}

function permissionForKbTool(toolName: string): 'readonly' | 'organize' | 'agent' {
  if (READONLY_KB_TOOL_NAMES.has(toolName)) return 'readonly';
  if (ORGANIZE_KB_TOOL_NAMES.has(toolName)) return 'organize';
  return 'agent';
}

function modesForPermission(permission: 'readonly' | 'organize' | 'agent'): Array<'organize' | 'agent'> {
  if (permission === 'readonly') return ['organize', 'agent'];
  if (permission === 'organize') return ['organize', 'agent'];
  return ['agent'];
}

function discoverPiSubagents(
  cwd: string,
  resolveBuiltinSubagentsDir?: () => string | null,
): PiSubagentModule[] {
  const builtinDir = resolveBuiltinSubagentsDir?.() ?? null;
  const userDirs = [
    path.join(os.homedir(), '.pi', 'agent', 'agents'),
    path.join(os.homedir(), '.agents'),
  ];
  const projectRoot = findNearestSubagentProjectRoot(cwd);
  const projectDirs = projectRoot
    ? [path.join(projectRoot, '.pi', 'agents'), path.join(projectRoot, '.agents')]
    : [];

  return [
    ...(builtinDir ? loadSubagentsFromDir(builtinDir, 'builtin') : []),
    ...userDirs.flatMap((dir) => loadSubagentsFromDir(dir, 'user')),
    ...projectDirs.flatMap((dir) => loadSubagentsFromDir(dir, 'project')),
  ];
}

function loadSubagentsFromDir(dir: string, source: PiSubagentModule['source']): PiSubagentModule[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => parseSubagentFile(path.join(dir, entry.name), source))
    .filter((agent): agent is PiSubagentModule => Boolean(agent));
}

function parseSubagentFile(filePath: string, source: PiSubagentModule['source']): PiSubagentModule | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(raw);
    const name = frontmatter.name || path.basename(filePath, path.extname(filePath));
    const description = frontmatter.description;
    if (!name || !description) return null;
    return {
      name,
      localName: name,
      description,
      source,
      filePath,
      ...(frontmatter.tools ? { tools: splitFrontmatterList(frontmatter.tools) } : {}),
      ...(frontmatter.skills ? { skills: splitFrontmatterList(frontmatter.skills) } : {}),
      ...(frontmatter.skill ? { skills: splitFrontmatterList(frontmatter.skill) } : {}),
      ...(frontmatter.model ? { model: frontmatter.model } : {}),
      ...(parsePositiveInteger(frontmatter.maxExecutionTimeMs) ? { maxExecutionTimeMs: parsePositiveInteger(frontmatter.maxExecutionTimeMs) } : {}),
      ...(parsePositiveInteger(frontmatter.maxTokens) ? { maxTokens: parsePositiveInteger(frontmatter.maxTokens) } : {}),
      ...(frontmatter.interactive === 'true' ? { interactive: true } : {}),
      ...(frontmatter.disabled === 'true' ? { disabled: true } : {}),
    };
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = raw.slice(3, end).trim();
  const parsed: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) parsed[key] = value;
  }
  return parsed;
}

function splitFrontmatterList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function findNearestSubagentProjectRoot(cwd: string): string | null {
  let current = cwd;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.pi')) || fs.existsSync(path.join(current, '.agents'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}
