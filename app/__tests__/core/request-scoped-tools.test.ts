import { describe, expect, it } from 'vitest';

describe('getRequestScopedTools', () => {
  it('returns base tools and does not include removed MCP tools', async () => {
    const mod = await import('@/lib/agent/tools');
    const tools = mod.getRequestScopedTools();
    const names = tools.map((tool) => tool.name);

    // Core KB tools should be present
    expect(names).toContain('list_files');
    expect(names).toContain('read_file');

    // MCP tools are now handled by pi-mcp-adapter extension,
    // not injected via getRequestScopedTools()
    expect(names).not.toContain('list_mcp_tools');
    expect(names).not.toContain('call_mcp_tool');
    expect(names.some((n) => n.startsWith('mcp__'))).toBe(false);
  });
});
