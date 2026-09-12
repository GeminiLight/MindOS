import { describe, expect, it } from 'vitest';
import { buildMindosMcpServerEntry, convertMcpServerEntry } from './entry.js';
import { DEFAULT_MCP_AGENTS as agents } from './registry.js';
import { buildTomlEntry, parseTomlMcpServerEntry, removeTomlEntry } from './toml.js';

describe('native MCP configuration contracts', () => {
  it('declares the HTTP transport for Claude Code', () => {
    expect(buildMindosMcpServerEntry(agents['claude-code']!, 'http')).toMatchObject({ type: 'http', url: expect.any(String) });
  });
  it('uses Codex native authorization headers and project configuration', () => {
    const entry = buildMindosMcpServerEntry(agents.codex!, 'http', { token: 'fixture-token' });
    expect(entry).toEqual({ url: 'http://127.0.0.1:8781/mcp', http_headers: { Authorization: 'Bearer fixture-token' } });
    const text = buildTomlEntry('mcp_servers', 'my.server', entry);
    expect(text).toContain('[mcp_servers."my.server".http_headers]');
    expect(parseTomlMcpServerEntry(text, 'mcp_servers', 'my.server')).toEqual(entry);
    expect(removeTomlEntry(text, 'mcp_servers', 'my.server').trim()).toBe('');
    expect(agents.codex!.project).toBe('.codex/config.toml');
  });
  it('uses the OpenCode 1.x native path and local command shape', () => {
    expect(agents.opencode).toMatchObject({ global: '~/.config/opencode/opencode.json', project: 'opencode.json', key: 'mcp', entryStyle: 'kilo' });
    expect(buildMindosMcpServerEntry(agents.opencode!, 'stdio')).toMatchObject({ type: 'local', command: ['mindos', 'mcp'] });
  });
  it('converts command arguments and environment in both directions without modifying the source', () => {
    const source = { command: 'node', args: ['a path/工具.js'], env: { NOTE: 'hello 🪴' } };
    const target = convertMcpServerEntry(source, agents.cursor!, agents['kilo-code']!);
    expect(target).toEqual({ type: 'local', command: ['node', 'a path/工具.js'], environment: { NOTE: 'hello 🪴' } });
    expect(convertMcpServerEntry(target, agents['kilo-code']!, agents.cursor!)).toEqual({ type: 'stdio', ...source });
    expect(source.command).toBe('node');
  });
  it('converts static headers without copying client-specific OAuth state', () => {
    expect(convertMcpServerEntry({ url: 'https://example.com/mcp', headers: { Authorization: 'Bearer test' } }, agents.cursor!, agents.codex!))
      .toEqual({ url: 'https://example.com/mcp', http_headers: { Authorization: 'Bearer test' } });
    expect(() => convertMcpServerEntry({ url: 'https://example.com', oauth: { clientId: 'private' } }, agents.cursor!, agents.codex!)).toThrow(/oauth/i);
  });
  it('rejects missing commands and nonportable variable references', () => {
    expect(() => convertMcpServerEntry({ command: [] }, agents['kilo-code']!, agents.cursor!)).toThrow();
    expect(() => convertMcpServerEntry({ command: 'node', env: { TOKEN: '${TOKEN}' } }, agents.cursor!, agents['kilo-code']!)).toThrow(/variable|interpolation/i);
  });
  it('reads comments without stripping hashes inside quoted values', () => {
    expect(parseTomlMcpServerEntry('[mcp_servers.test] # connection\nurl = "https://example.com/#mcp" # endpoint\nenabled = false # disabled\n', 'mcp_servers', 'test'))
      .toEqual({ url: 'https://example.com/#mcp', enabled: false });
  });
  it('preserves Codex options and quoted header names through TOML', () => {
    const entry = { url: 'https://example.com', enabled: false, startup_timeout_sec: 20, enabled_tools: ['search'], http_headers: { 'X.Custom': 'quoted "value"' } };
    expect(parseTomlMcpServerEntry(buildTomlEntry('mcp_servers', 'test', entry), 'mcp_servers', 'test')).toEqual(entry);
  });
});
