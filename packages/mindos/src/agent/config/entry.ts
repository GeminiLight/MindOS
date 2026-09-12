import type { AgentConfigLocationDef, AgentConfigTransport } from './types.js';

export const DEFAULT_MINDOS_MCP_PORT = 8781;

export function defaultMindosMcpUrl(port: number = DEFAULT_MINDOS_MCP_PORT): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export type MindosMcpServerEntryOptions = { url?: string; token?: string; fallbackPort?: number };
type EntryTarget = Pick<AgentConfigLocationDef, 'entryStyle' | 'format'>;

/** Pure, browser-safe native entry generator, shared by previews, HTTP and CLI writes. */
export function buildMindosMcpServerEntry(
  def: EntryTarget,
  transport: AgentConfigTransport,
  options: MindosMcpServerEntryOptions = {},
): Record<string, unknown> {
  const entry: Record<string, unknown> = transport === 'stdio'
    ? { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } }
    : { type: 'http', url: options.url || defaultMindosMcpUrl(options.fallbackPort) };
  if (transport === 'http' && options.token) entry.headers = { Authorization: `Bearer ${options.token}` };
  const converted = convertMcpServerEntry(entry, {}, def);
  if (def.entryStyle === 'kilo') converted.enabled = true;
  return converted;
}

/**
 * Translate transport fields, never authorization policy. A client-specific
 * field or interpolation must be reviewed instead of silently disappearing.
 * Same-style copies retain their native fields exactly.
 */
export function convertMcpServerEntry(
  entry: Record<string, unknown>,
  source: EntryTarget,
  target: EntryTarget,
): Record<string, unknown> {
  const sourceStyle = source.entryStyle ?? 'standard';
  const targetStyle = target.entryStyle ?? 'standard';
  const kind = classifyMcpServerEntryTransport(entry);
  if (kind === 'unknown') throw new Error('MCP configuration needs a command or URL.');
  const command = Array.isArray(entry.command) ? entry.command[0] : entry.command;
  const args = Array.isArray(entry.command) ? entry.command.slice(1) : entry.args;
  if (kind === 'stdio' && (typeof command !== 'string' || !command.trim())) throw new Error('MCP command must not be empty.');
  if (args !== undefined && (!Array.isArray(args) || args.some(v => typeof v !== 'string'))) throw new Error('MCP arguments must be strings.');
  if (sourceStyle === targetStyle && (source.format ?? 'json') === (target.format ?? 'json')) return structuredClone(entry);

  const fields = new Set(['type', 'command', 'args', 'env', 'environment', 'url', 'headers', 'http_headers', 'enabled']);
  const unknown = Object.keys(entry).filter(key => !fields.has(key));
  if (unknown.length) throw new Error(`Review client-specific fields before copying: ${unknown.join(', ')}.`);
  if (entry.type && !['stdio', 'http', 'local', 'remote'].includes(String(entry.type))) {
    throw new Error(`Transport ${String(entry.type)} cannot be translated automatically.`);
  }
  if (/\$\{|\{env:|\$\{env:/.test(JSON.stringify(entry))) {
    throw new Error('Environment variable interpolation differs between these agents. Configure the variable in the target agent first.');
  }
  const result: Record<string, unknown> = {};
  if (kind === 'stdio') {
    result.type = targetStyle === 'kilo' ? 'local' : 'stdio';
    result.command = targetStyle === 'kilo' ? [command, ...(args as string[] ?? [])] : command;
    if (targetStyle !== 'kilo' && args !== undefined) result.args = args;
    const env = entry.environment ?? entry.env;
    if (env !== undefined) result[targetStyle === 'kilo' ? 'environment' : 'env'] = structuredClone(env);
  } else {
    result.type = targetStyle === 'kilo' ? 'remote' : 'http';
    result.url = entry.url;
    const headers = entry.http_headers ?? entry.headers;
    if (headers !== undefined) result[targetStyle === 'codex' ? 'http_headers' : 'headers'] = structuredClone(headers);
  }
  if (targetStyle === 'codex') delete result.type;
  if (entry.enabled !== undefined) result.enabled = entry.enabled;
  return result;
}

export function classifyMcpServerEntryTransport(entry: Record<string, unknown>): 'stdio' | 'http' | 'unknown' {
  if (entry.type === 'stdio' || entry.type === 'local' || typeof entry.command === 'string' || Array.isArray(entry.command)) return 'stdio';
  return typeof entry.url === 'string' ? 'http' : 'unknown';
}
