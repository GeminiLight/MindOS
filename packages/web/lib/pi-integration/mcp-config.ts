/**
 * MCP configuration helpers for pi-mcp-adapter integration.
 *
 * pi-mcp-adapter defaults to ~/.pi/agent/mcp.json, but MindOS stores its
 * MCP config at ~/.mindos/mcp.json. The adapter reads `--mcp-config` from
 * process.argv at module-load time (getConfigPathFromArgv()), so we inject
 * the flag before the extension is loaded by DefaultResourceLoader.
 *
 * This module must be imported early — before any pi-coding-agent extension
 * loading happens (i.e. before resourceLoader.reload() in ask/route.ts).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export const MINDOS_MCP_CONFIG_PATH = path.join(os.homedir(), '.mindos', 'mcp.json');

// Inject --mcp-config into process.argv so pi-mcp-adapter reads MindOS's config.
// Idempotent — safe to import multiple times.
if (!process.argv.includes('--mcp-config')) {
  process.argv.push('--mcp-config', MINDOS_MCP_CONFIG_PATH);
}

/** Parsed MCP server entry from mcp.json */
export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  lifecycle?: 'keep-alive' | 'lazy' | 'eager';
  directTools?: boolean | string[];
  [key: string]: unknown;
}

/** Root mcp.json structure */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
  settings?: {
    toolPrefix?: 'server' | 'none' | 'short';
    idleTimeout?: number;
    directTools?: boolean;
  };
  imports?: string[];
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
  const cachePath = path.join(os.homedir(), '.pi', 'agent', 'mcp-cache.json');
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    return raw?.servers ?? null;
  } catch {
    return null;
  }
}
