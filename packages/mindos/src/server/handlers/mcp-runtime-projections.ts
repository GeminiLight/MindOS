import type {
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeStatus,
} from '../../agent/runtime/registry.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';
import type { MindosMcpAgentProfile } from './mcp-agents.js';
import type { MindosMcpConfigFile, MindosMcpServerEntry } from './mcp-tools.js';

export type AgentRuntimeMcpProjectionStatus =
  | 'ready'
  | 'projectable'
  | 'limited'
  | 'blocked'
  | 'unknown';

export type AgentRuntimeMcpProjectionReason = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

export type AgentRuntimeMcpProjection = {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  mcpAgentKey?: string;
  status: AgentRuntimeMcpProjectionStatus;
  configuredServerCount: number;
  configuredServers: string[];
  configuredSources: string[];
  mindosConfigServerCount: number;
  mindosConfigServers: string[];
  projectedServerCount: number;
  projectedServers: string[];
  supportsNativeConfig: boolean;
  supportsMindosProjection: boolean;
  reasons: AgentRuntimeMcpProjectionReason[];
  blockers?: string[];
};

export type AgentRuntimeMcpProjectionsPayload = {
  schemaVersion: 1;
  projections: AgentRuntimeMcpProjection[];
};

export type AgentRuntimeMcpProjectionServices = {
  listRuntimes(): AgentRuntimeDescriptor[] | Promise<AgentRuntimeDescriptor[]>;
  listMcpAgents(): MindosMcpAgentProfile[] | Promise<MindosMcpAgentProfile[]>;
  readMcpConfig?(): MindosMcpConfigFile;
};

type MindosMcpProjectionContext = {
  configServers: string[];
  projectedServers: string[];
};

export async function handleAgentRuntimeMcpProjectionsGet(
  searchParams: URLSearchParams,
  services: AgentRuntimeMcpProjectionServices,
): Promise<MindosServerResponse<AgentRuntimeMcpProjectionsPayload | { error: string }>> {
  try {
    const [runtimes, mcpAgents] = await Promise.all([
      services.listRuntimes(),
      services.listMcpAgents(),
    ]);
    const payload = buildAgentRuntimeMcpProjectionsPayload({
      runtimes,
      mcpAgents,
      mindosMcpConfig: services.readMcpConfig?.(),
    });
    const runtimeFilter = searchParams.get('runtime')?.trim();
    const filtered = runtimeFilter
      ? payload.projections.filter((projection) => projection.runtimeId === runtimeFilter || projection.runtimeKind === runtimeFilter)
      : payload.projections;
    return json(
      { ...payload, projections: filtered },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function buildAgentRuntimeMcpProjectionsPayload(input: {
  runtimes: AgentRuntimeDescriptor[];
  mcpAgents: MindosMcpAgentProfile[];
  mindosMcpConfig?: MindosMcpConfigFile | null;
}): AgentRuntimeMcpProjectionsPayload {
  const agentByKey = new Map(input.mcpAgents.map((agent) => [agent.key, agent]));
  const mindosContext = buildMindosMcpProjectionContext(input.mindosMcpConfig);
  return {
    schemaVersion: 1,
    projections: input.runtimes.map((runtime) => buildRuntimeMcpProjection({
      runtime,
      agentByKey,
      mindosContext,
    })),
  };
}

function buildRuntimeMcpProjection(input: {
  runtime: AgentRuntimeDescriptor;
  agentByKey: Map<string, MindosMcpAgentProfile>;
  mindosContext: MindosMcpProjectionContext;
}): AgentRuntimeMcpProjection {
  const { runtime, agentByKey, mindosContext } = input;
  const mcpAgent = resolveRuntimeMcpAgent(runtime, agentByKey);
  const mcpAgentKey = mcpAgent?.key ?? fallbackMcpAgentKey(runtime);
  const configuredServers = uniqSorted(mcpAgent?.configuredMcpServers ?? []);
  const configuredSources = uniqSorted(mcpAgent?.configuredMcpSources ?? []);
  const supportsNativeConfig = !!mcpAgent || runtime.capabilities.supportsMcpConfig;
  const supportsMindosProjection = runtime.kind === 'mindos' || !!mcpAgent;
  const projectedServers = runtime.kind === 'mindos'
    ? mindosContext.projectedServers
    : configuredServers;
  const reasons: AgentRuntimeMcpProjectionReason[] = [];
  const blockers: string[] = [];

  reasons.push(reason(
    'runtime-available',
    runtime.status === 'available' ? 'satisfied' : 'missing',
    runtime.status === 'available' ? 'mindos' : 'shared',
    runtime.status === 'available'
      ? `${runtime.name} is available for MCP projection diagnostics.`
      : `${runtime.name} is not available, so MCP readiness cannot be trusted.`,
  ));

  reasons.push(reason(
    'mcp-agent-profile',
    mcpAgent ? 'satisfied' : runtime.kind === 'acp' ? 'unknown' : 'missing',
    'mindos',
    mcpAgent
      ? `MindOS found the MCP configuration profile for ${mcpAgent.name}.`
      : runtime.kind === 'acp'
        ? 'Generic ACP runtimes need an adapter-specific MCP profile before MindOS can project tooling confidently.'
        : `MindOS does not have an MCP configuration profile for ${runtime.name}.`,
  ));

  reasons.push(reason(
    'mindos-mcp-config',
    mindosContext.configServers.length > 0 ? 'satisfied' : 'missing',
    'mindos',
    mindosContext.configServers.length > 0
      ? 'The canonical MindOS MCP config has server entries that can be projected to compatible runtimes.'
      : 'The canonical MindOS MCP config has no server entries yet.',
  ));

  if (runtime.kind === 'mindos') {
    reasons.push(reason(
      'mindos-runtime-allowlist',
      mindosContext.projectedServers.length > 0 ? 'satisfied' : mindosContext.configServers.length > 0 ? 'missing' : 'not-applicable',
      'mindos',
      mindosContext.projectedServers.length > 0
        ? 'MindOS Agent has an explicit MCP allowlist for bounded runtime exposure.'
        : mindosContext.configServers.length > 0
          ? 'MindOS Agent only receives servers explicitly allowlisted for the runtime.'
          : 'No MindOS MCP servers are configured to allowlist yet.',
    ));
  } else {
    reasons.push(reason(
      'runtime-native-mcp-config',
      configuredServers.length > 0 ? 'satisfied' : mcpAgent ? 'missing' : 'unknown',
      runtime.kind === 'acp' ? 'external' : 'shared',
      configuredServers.length > 0
        ? `${runtime.name} has MCP server entries in its runtime-specific configuration.`
        : mcpAgent
          ? `${runtime.name} has a known MCP config surface, but no configured server entries were detected.`
          : `${runtime.name} does not expose a known MCP config surface to MindOS yet.`,
    ));
  }

  let status: AgentRuntimeMcpProjectionStatus;
  if (runtime.status !== 'available') {
    status = 'blocked';
    blockers.push('runtime-available');
  } else if (!supportsNativeConfig) {
    status = runtime.kind === 'acp' ? 'unknown' : 'blocked';
    blockers.push(runtime.kind === 'acp' ? 'mcp-agent-profile' : 'runtime-mcp-config');
  } else if (runtime.kind === 'mindos') {
    if (mindosContext.projectedServers.length > 0) {
      status = 'ready';
    } else if (mindosContext.configServers.length > 0) {
      status = 'projectable';
      blockers.push('mindos-runtime-allowlist');
    } else {
      status = 'limited';
      blockers.push('mindos-mcp-config');
    }
  } else if (configuredServers.length > 0) {
    status = 'ready';
  } else if (mindosContext.configServers.length > 0 && mcpAgent) {
    status = 'projectable';
    blockers.push('runtime-native-mcp-config');
  } else if (mcpAgent) {
    status = 'limited';
    blockers.push('runtime-native-mcp-config');
  } else {
    status = 'unknown';
    blockers.push('mcp-agent-profile');
  }

  return {
    schemaVersion: 1,
    runtimeId: runtime.runtimeId ?? runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeStatus: runtime.status,
    ...(mcpAgentKey ? { mcpAgentKey } : {}),
    status,
    configuredServerCount: configuredServers.length,
    configuredServers,
    configuredSources,
    mindosConfigServerCount: mindosContext.configServers.length,
    mindosConfigServers: mindosContext.configServers,
    projectedServerCount: projectedServers.length,
    projectedServers,
    supportsNativeConfig,
    supportsMindosProjection,
    reasons,
    ...(blockers.length > 0 ? { blockers: uniqSorted(blockers) } : {}),
  };
}

function resolveRuntimeMcpAgent(
  runtime: AgentRuntimeDescriptor,
  agentByKey: Map<string, MindosMcpAgentProfile>,
): MindosMcpAgentProfile | undefined {
  for (const key of runtimeMcpAgentKeyCandidates(runtime)) {
    const agent = agentByKey.get(key);
    if (agent) return agent;
  }
  return undefined;
}

function runtimeMcpAgentKeyCandidates(runtime: AgentRuntimeDescriptor): string[] {
  return uniqSorted([
    runtime.mcpAgentKey,
    fallbackMcpAgentKey(runtime),
    runtime.runtimeId,
    runtime.id,
    runtime.sourceAgentId,
    runtime.canonicalAgentId,
    ...(runtime.aliases ?? []),
  ]);
}

function fallbackMcpAgentKey(runtime: AgentRuntimeDescriptor): string | undefined {
  if (runtime.kind === 'mindos') return 'mindos';
  if (runtime.kind === 'codex') return 'codex';
  if (runtime.kind === 'claude') return 'claude-code';
  return undefined;
}

function buildMindosMcpProjectionContext(config: MindosMcpConfigFile | null | undefined): MindosMcpProjectionContext {
  const normalized = normalizeMindosMcpConfig(config);
  const configServers = uniqSorted(Object.keys(normalized.mcpServers));
  const projectedServers = uniqSorted(Object.entries(normalized.mcpServers)
    .filter(([name, entry]) => hasMindosAgentAccess(name, entry, normalized))
    .map(([name]) => name));
  return { configServers, projectedServers };
}

function normalizeMindosMcpConfig(config: MindosMcpConfigFile | null | undefined): MindosMcpConfigFile {
  if (!config || typeof config !== 'object' || !config.mcpServers || typeof config.mcpServers !== 'object') {
    return { mcpServers: {} };
  }
  return config;
}

function hasMindosAgentAccess(name: string, entry: MindosMcpServerEntry, config: MindosMcpConfigFile): boolean {
  const settings = config.settings;
  const globalAllowlist = readRecord(readRecord(settings, 'mindosAgent'), 'mcpServers');
  return normalizeMindosAccess(globalAllowlist?.[name])
    || normalizeMindosAccess(entry.mindosAgent)
    || normalizeMindosAccess(readRecord(entry.mindos, 'agent'));
}

function normalizeMindosAccess(access: unknown): boolean {
  if (access === true) return true;
  if (access === false || access === undefined || access === null) return false;
  if (Array.isArray(access)) return access.some((item) => typeof item === 'string' && item.trim().length > 0);
  if (typeof access !== 'object') return false;
  const record = access as Record<string, unknown>;
  if (record.enabled === false) return false;
  if (record.enabled === true) return true;
  if (record.tools === true || record.directTools === true) return true;
  if (Array.isArray(record.tools) && record.tools.some((item) => typeof item === 'string' && item.trim().length > 0)) return true;
  if (Array.isArray(record.directTools) && record.directTools.some((item) => typeof item === 'string' && item.trim().length > 0)) return true;
  return false;
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const child = (value as Record<string, unknown>)[key];
  if (!child || typeof child !== 'object' || Array.isArray(child)) return undefined;
  return child as Record<string, unknown>;
}

function reason(
  id: string,
  status: AgentRuntimeCompatibilityRequirementStatus,
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimeMcpProjectionReason {
  return { id, status, owner, summary };
}

function uniqSorted(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))).sort();
}
