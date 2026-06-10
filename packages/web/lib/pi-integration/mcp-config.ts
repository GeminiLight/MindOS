/**
 * MCP configuration helpers for MindOS and pi-mcp-adapter integration.
 *
 * ~/.mindos/mcp.json remains the user-owned settings file used by the MCP
 * settings UI. MindOS Agent runtime must not hand that full config to
 * pi-mcp-adapter directly: the upstream adapter also merges generic global,
 * project, and imported MCP configs. Instead we derive a bounded runtime config
 * that only contains servers explicitly allowlisted for MindOS Agent.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export const MINDOS_MCP_CONFIG_PATH = path.join(os.homedir(), '.mindos', 'mcp.json');
export const MINDOS_MCP_RUNTIME_DIR = path.join(os.homedir(), '.mindos', 'runtime');
export const MINDOS_AGENT_MCP_CONFIG_PATH = path.join(MINDOS_MCP_RUNTIME_DIR, 'pi-mcp-agent.json');
export const MINDOS_AGENT_MCP_SANDBOX_HOME = path.join(MINDOS_MCP_RUNTIME_DIR, 'mcp-sandbox-home');
export const MINDOS_AGENT_MCP_SANDBOX_CWD = path.join(MINDOS_MCP_RUNTIME_DIR, 'mcp-sandbox-cwd');
export const PI_MCP_METADATA_CACHE_PATH = path.join(os.homedir(), '.pi', 'agent', 'mcp-cache.json');

/** Parsed MCP server entry from mcp.json */
export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  lifecycle?: 'keep-alive' | 'lazy' | 'eager';
  directTools?: boolean | string[];
  mindosAgent?: MindosMcpServerAccess;
  mindos?: {
    agent?: MindosMcpServerAccess;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type MindosMcpServerAccess =
  | boolean
  | string[]
  | {
    enabled?: boolean;
    tools?: true | string[];
    directTools?: true | string[];
  };

/** Root mcp.json structure */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
  settings?: {
    toolPrefix?: 'server' | 'none' | 'short';
    idleTimeout?: number;
    directTools?: boolean;
    disableProxyTool?: boolean;
    mindosAgent?: {
      mcpServers?: Record<string, MindosMcpServerAccess>;
    };
  };
  imports?: string[];
}

export interface MindosAgentMcpRuntimeConfig {
  configPath: string;
  sandboxHome: string;
  sandboxCwd: string;
  serverPolicies: Record<string, true | string[]>;
  serverCount: number;
  proxyAllowed: boolean;
}

/** Read and parse ~/.mindos/mcp.json. Returns empty config if missing/invalid. */
export function readMcpConfig(): McpConfigFile {
  try {
    if (!fs.existsSync(MINDOS_MCP_CONFIG_PATH)) return { mcpServers: {} };
    const raw = JSON.parse(fs.readFileSync(MINDOS_MCP_CONFIG_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return { mcpServers: {} };
    return {
      mcpServers: (raw.mcpServers ?? raw['mcp-servers'] ?? {}) as Record<string, McpServerEntry>,
      settings: raw.settings,
      imports: raw.imports,
    };
  } catch {
    return { mcpServers: {} };
  }
}

/** Write the full config back to ~/.mindos/mcp.json (atomic via rename). */
export function writeMcpConfig(config: McpConfigFile): void {
  const dir = path.dirname(MINDOS_MCP_CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${MINDOS_MCP_CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, MINDOS_MCP_CONFIG_PATH);
}

/**
 * Update the directTools field for a single server.
 * - `false` or `undefined`: remove directTools key (proxy only)
 * - `true`: all tools direct
 * - `string[]`: specific tools direct
 */
export function updateServerDirectTools(
  serverName: string,
  directTools: boolean | string[] | false,
): void {
  const config = readMcpConfig();
  const server = config.mcpServers[serverName];
  if (!server) return;

  if (directTools === false || directTools === undefined) {
    delete server.directTools;
  } else {
    server.directTools = directTools;
  }

  writeMcpConfig(config);
}

/**
 * Read the pi-mcp-adapter metadata cache to get tool lists for all servers.
 * The cache is at ~/.pi/agent/mcp-cache.json (written by pi-mcp-adapter).
 */
export function readMcpToolCache(): Record<string, { tools: Array<{ name: string; description?: string }>; cachedAt?: number }> | null {
  try {
    if (!fs.existsSync(PI_MCP_METADATA_CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(PI_MCP_METADATA_CACHE_PATH, 'utf-8'));
    return raw?.servers ?? null;
  } catch {
    return null;
  }
}

export function ensureMindosAgentMcpRuntimeConfig(): MindosAgentMcpRuntimeConfig {
  const source = readMcpConfig();
  const bounded = createBoundedMindosAgentMcpConfig(source);
  fs.mkdirSync(MINDOS_MCP_RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(MINDOS_AGENT_MCP_SANDBOX_HOME, { recursive: true });
  fs.mkdirSync(MINDOS_AGENT_MCP_SANDBOX_CWD, { recursive: true });

  writeJsonFilePrivate(MINDOS_AGENT_MCP_CONFIG_PATH, bounded.config);
  writeFilteredMcpMetadataCache(bounded.serverPolicies);

  return {
    configPath: MINDOS_AGENT_MCP_CONFIG_PATH,
    sandboxHome: MINDOS_AGENT_MCP_SANDBOX_HOME,
    sandboxCwd: MINDOS_AGENT_MCP_SANDBOX_CWD,
    serverPolicies: bounded.serverPolicies,
    serverCount: Object.keys(bounded.config.mcpServers).length,
    proxyAllowed: bounded.proxyAllowed,
  };
}

export function createBoundedMindosAgentMcpConfig(config: McpConfigFile): {
  config: McpConfigFile;
  serverPolicies: Record<string, true | string[]>;
  proxyAllowed: boolean;
} {
  const serverPolicies: Record<string, true | string[]> = {};
  const boundedServers: Record<string, McpServerEntry> = {};
  const globalAllowlist = config.settings?.mindosAgent?.mcpServers ?? {};

  for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
    const access = resolveMindosAgentServerAccess(name, entry, globalAllowlist);
    if (!access) continue;
    const cloned = cloneServerEntryForRuntime(entry);
    cloned.directTools = access;
    boundedServers[name] = cloned;
    serverPolicies[name] = access;
  }

  const proxyAllowed = Object.values(serverPolicies).length > 0
    && Object.values(serverPolicies).every((access) => access === true)
    && config.settings?.disableProxyTool !== true;

  return {
    config: {
      mcpServers: boundedServers,
      settings: {
        ...(config.settings?.toolPrefix ? { toolPrefix: config.settings.toolPrefix } : {}),
        ...(typeof config.settings?.idleTimeout === 'number' ? { idleTimeout: config.settings.idleTimeout } : {}),
        disableProxyTool: !proxyAllowed,
      },
    },
    serverPolicies,
    proxyAllowed,
  };
}

function resolveMindosAgentServerAccess(
  serverName: string,
  entry: McpServerEntry,
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
  const normalized = [...new Set(tools.map((tool) => tool.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : null;
}

function cloneServerEntryForRuntime(entry: McpServerEntry): McpServerEntry {
  const {
    mindosAgent: _mindosAgent,
    mindos: _mindos,
    ...rest
  } = entry;
  return JSON.parse(JSON.stringify(rest)) as McpServerEntry;
}

function writeFilteredMcpMetadataCache(serverPolicies: Record<string, true | string[]>): void {
  const cachePath = path.join(MINDOS_AGENT_MCP_SANDBOX_HOME, '.pi', 'agent', 'mcp-cache.json');
  const cache = readRawMcpMetadataCache();
  if (!cache) {
    writeJsonFilePrivate(cachePath, { version: 1, servers: {} });
    return;
  }

  const filteredServers: Record<string, unknown> = {};
  const sourceServers = cache.servers && typeof cache.servers === 'object'
    ? cache.servers as Record<string, Record<string, unknown>>
    : {};

  for (const [serverName, policy] of Object.entries(serverPolicies)) {
    const source = sourceServers[serverName];
    if (!source || typeof source !== 'object') continue;
    const next = { ...source };
    if (policy !== true) {
      const allowed = new Set(policy);
      next.tools = Array.isArray(source.tools)
        ? source.tools.filter((tool: unknown) => (
          !!tool
          && typeof tool === 'object'
          && typeof (tool as { name?: unknown }).name === 'string'
          && allowed.has((tool as { name: string }).name)
        ))
        : [];
      next.resources = [];
    }
    filteredServers[serverName] = next;
  }

  writeJsonFilePrivate(cachePath, { version: 1, servers: filteredServers });
}

function readRawMcpMetadataCache(): { version?: unknown; servers?: unknown } | null {
  try {
    if (!fs.existsSync(PI_MCP_METADATA_CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(PI_MCP_METADATA_CACHE_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw as { version?: unknown; servers?: unknown };
  } catch {
    return null;
  }
}

function writeJsonFilePrivate(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
}
