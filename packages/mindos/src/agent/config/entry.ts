import type { AgentConfigLocationDef, AgentConfigTransport } from './types.js';

export const DEFAULT_MINDOS_MCP_PORT = 8781;

/**
 * 127.0.0.1, not localhost: the MCP server binds an IPv4 socket and some
 * Windows HTTP stacks resolve localhost to ::1 first without falling back.
 */
export function defaultMindosMcpUrl(port: number = DEFAULT_MINDOS_MCP_PORT): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export type MindosMcpServerEntryOptions = {
  url?: string;
  token?: string;
  /** Port used to build the default URL when `url` is empty. */
  fallbackPort?: number;
};

/**
 * The MindOS server entry written into a downstream agent's config. Kilo-style
 * agents use `{ type: 'local' | 'remote', command: string[], environment }`;
 * everyone else the common Claude / Cursor shape. Shared by the product
 * server (`POST /api/mcp/install`) and `mindos mcp install`.
 */
export function buildMindosMcpServerEntry(
  def: Pick<AgentConfigLocationDef, 'entryStyle'>,
  transport: AgentConfigTransport,
  options: MindosMcpServerEntryOptions = {},
): Record<string, unknown> {
  const url = options.url || defaultMindosMcpUrl(options.fallbackPort);
  if (def.entryStyle === 'kilo') {
    if (transport === 'stdio') {
      return {
        type: 'local',
        command: ['mindos', 'mcp'],
        environment: { MCP_TRANSPORT: 'stdio' },
        enabled: true,
      };
    }
    const entry: Record<string, unknown> = { type: 'remote', url, enabled: true };
    if (options.token) entry.headers = { Authorization: `Bearer ${options.token}` };
    return entry;
  }

  if (transport === 'stdio') {
    return { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } };
  }
  const entry: Record<string, unknown> = { url };
  if (options.token) entry.headers = { Authorization: `Bearer ${options.token}` };
  return entry;
}

/** stdio when the entry runs a command (any agent's spelling), http when it names a URL. */
export function classifyMcpServerEntryTransport(entry: Record<string, unknown>): 'stdio' | 'http' | 'unknown' {
  if (entry.type === 'stdio' || entry.type === 'local' || typeof entry.command === 'string' || Array.isArray(entry.command)) {
    return 'stdio';
  }
  return typeof entry.url === 'string' ? 'http' : 'unknown';
}
