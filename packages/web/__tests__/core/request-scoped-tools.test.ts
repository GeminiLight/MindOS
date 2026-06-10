import { describe, expect, it } from 'vitest';

describe('getRequestScopedTools', () => {
  it('returns full agent request tools including ACP and A2A delegation', async () => {
    const mod = await import('@/lib/agent/tools');
    const tools = mod.getRequestScopedTools();
    const names = tools.map((tool) => tool.name);

    // Core KB tools should be present
    expect(names).toContain('list_files');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('delete_file');

    // Agent mode can delegate to ACP/A2A tools.
    expect(names).toContain('list_acp_agents');
    expect(names).toContain('call_acp_agent');
    expect(names).toContain('list_remote_agents');
    expect(names).toContain('delegate_to_agent');
    expect(names).toContain('orchestrate');

    // MCP tools are now handled by pi-mcp-adapter extension,
    // not injected via getRequestScopedTools()
    expect(names).not.toContain('list_mcp_tools');
    expect(names).not.toContain('call_mcp_tool');
    expect(names.some((n) => n.startsWith('mcp__'))).toBe(false);
  }, 15_000);
});
