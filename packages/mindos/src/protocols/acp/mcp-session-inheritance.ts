import type { McpCapabilities, McpServer } from '@agentclientprotocol/sdk';
import type { AcpSessionMcpServerSummary } from './types.js';

export type AcpSessionMcpAccess =
  | boolean
  | string[]
  | {
    enabled?: boolean;
    tools?: true | string[];
    directTools?: true | string[];
  };

export type AcpSessionMcpConfigEntry = {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  type?: unknown;
  transport?: unknown;
  mindosAgent?: AcpSessionMcpAccess;
  agentSession?: AcpSessionMcpAccess;
  agentSessions?: AcpSessionMcpAccess;
  acpSession?: AcpSessionMcpAccess;
  acpSessions?: AcpSessionMcpAccess;
  mindos?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AcpSessionMcpConfigLike = {
  mcpServers?: Record<string, AcpSessionMcpConfigEntry>;
  'mcp-servers'?: Record<string, AcpSessionMcpConfigEntry>;
  settings?: Record<string, unknown>;
};

export type AcpSessionMcpInheritancePlan = {
  servers: McpServer[];
  summaries: AcpSessionMcpServerSummary[];
  skipped: Array<{ name: string; reason: string }>;
};

export function buildAcpSessionMcpInheritancePlan(input: {
  config?: AcpSessionMcpConfigLike | null;
  agentCapabilities?: { mcpCapabilities?: McpCapabilities } | null;
}): AcpSessionMcpInheritancePlan {
  const config = normalizeMcpConfig(input.config);
  const capabilities = input.agentCapabilities?.mcpCapabilities;
  const servers: McpServer[] = [];
  const summaries: AcpSessionMcpServerSummary[] = [];
  const skipped: AcpSessionMcpInheritancePlan['skipped'] = [];

  for (const [name, entry] of Object.entries(config.mcpServers).sort(([left], [right]) => left.localeCompare(right))) {
    if (isUnsafeName(name)) {
      skipped.push({ name, reason: 'unsafe-name' });
      continue;
    }
    const access = resolveAgentSessionAccess(name, entry, config);
    if (access !== true) {
      skipped.push({ name, reason: access ? 'tool-subset-not-injectable' : 'not-allowlisted' });
      continue;
    }
    const server = toAcpMcpServer(name, entry, capabilities);
    if (!server) {
      skipped.push({ name, reason: 'unsupported-transport' });
      continue;
    }
    servers.push(server);
    summaries.push({ name, type: mcpServerType(server) });
  }

  return { servers, summaries, skipped };
}

export function resolveAcpSessionMcpServers(input: {
  config?: AcpSessionMcpConfigLike | null;
  agentCapabilities?: { mcpCapabilities?: McpCapabilities } | null;
}): McpServer[] {
  return buildAcpSessionMcpInheritancePlan(input).servers;
}

function normalizeMcpConfig(config: AcpSessionMcpConfigLike | null | undefined): { mcpServers: Record<string, AcpSessionMcpConfigEntry>; settings?: Record<string, unknown> } {
  if (!config || typeof config !== 'object') return { mcpServers: {} };
  const mcpServers = readRecord(config.mcpServers) ?? readRecord(config['mcp-servers']) ?? {};
  return {
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers)
        .filter(([, entry]) => !!entry && typeof entry === 'object' && !Array.isArray(entry)),
    ) as Record<string, AcpSessionMcpConfigEntry>,
    ...(readRecord(config.settings) ? { settings: readRecord(config.settings) } : {}),
  };
}

function resolveAgentSessionAccess(
  name: string,
  entry: AcpSessionMcpConfigEntry,
  config: { settings?: Record<string, unknown> },
): true | string[] | null {
  const settings = config.settings;
  const agentSessions = readRecord(settings?.agentSessions);
  const acpSessions = readRecord(settings?.acpSessions);
  const mindosAgent = readRecord(settings?.mindosAgent);
  const mindos = readRecord(entry.mindos);
  return normalizeAccess(readRecord(agentSessions?.mcpServers)?.[name])
    ?? normalizeAccess(readRecord(acpSessions?.mcpServers)?.[name])
    ?? normalizeAccess(readRecord(mindosAgent?.mcpServers)?.[name])
    ?? normalizeAccess(entry.agentSessions)
    ?? normalizeAccess(entry.agentSession)
    ?? normalizeAccess(entry.acpSessions)
    ?? normalizeAccess(entry.acpSession)
    ?? normalizeAccess(entry.mindosAgent)
    ?? normalizeAccess(mindos?.agentSessions)
    ?? normalizeAccess(mindos?.agent)
    ?? null;
}

function normalizeAccess(access: unknown): true | string[] | null {
  if (access === true) return true;
  if (access === false || access === undefined || access === null) return null;
  if (Array.isArray(access)) return normalizeToolNames(access);
  if (!access || typeof access !== 'object') return null;
  const record = access as Record<string, unknown>;
  if (record.enabled === false) return null;
  if (record.tools === true || record.directTools === true || record.enabled === true) return true;
  if (Array.isArray(record.tools)) return normalizeToolNames(record.tools);
  if (Array.isArray(record.directTools)) return normalizeToolNames(record.directTools);
  return null;
}

function normalizeToolNames(value: unknown[]): string[] | null {
  const tools = Array.from(new Set(value.map((item) => (
    typeof item === 'string' ? item.trim() : ''
  )).filter(Boolean)));
  return tools.length > 0 ? tools : null;
}

function toAcpMcpServer(
  name: string,
  entry: AcpSessionMcpConfigEntry,
  capabilities: McpCapabilities | undefined,
): McpServer | null {
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (url) {
    const transport = normalizeTransport(entry.type) ?? normalizeTransport(entry.transport) ?? 'http';
    if (transport === 'sse') {
      if (capabilities?.sse !== true) return null;
      return { type: 'sse', name, url, headers: normalizeHeaders(entry.headers) };
    }
    if (transport === 'http') {
      if (capabilities?.http !== true) return null;
      return { type: 'http', name, url, headers: normalizeHeaders(entry.headers) };
    }
    return null;
  }

  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  if (!command) return null;
  return {
    name,
    command,
    args: normalizeStringArray(entry.args),
    env: normalizeEnv(entry.env),
  };
}

function normalizeTransport(value: unknown): 'http' | 'sse' | 'stdio' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'http' || normalized === 'streamable-http') return 'http';
  if (normalized === 'sse') return 'sse';
  if (normalized === 'stdio') return 'stdio';
  return null;
}

function normalizeHeaders(value: unknown): Array<{ name: string; value: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const headerValue = typeof record.value === 'string' ? record.value : '';
      return name ? [{ name, value: headerValue }] : [];
    });
  }
  const record = readRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([name, headerValue]) => (
    typeof headerValue === 'string' ? [{ name, value: headerValue }] : []
  ));
}

function normalizeEnv(value: unknown): Array<{ name: string; value: string }> {
  const record = readRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([name, envValue]) => (
    typeof envValue === 'string' ? [{ name, value: envValue }] : []
  ));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mcpServerType(server: McpServer): AcpSessionMcpServerSummary['type'] {
  if ('type' in server && server.type === 'http') return 'http';
  if ('type' in server && server.type === 'sse') return 'sse';
  return 'stdio';
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isUnsafeName(name: string): boolean {
  return !name.trim() || name === '__proto__' || name === 'prototype' || name === 'constructor';
}
