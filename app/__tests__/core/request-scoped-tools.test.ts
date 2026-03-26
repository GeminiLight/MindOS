import { describe, expect, it, vi, beforeEach } from 'vitest';

const listMcporterServers = vi.fn();
const listMcporterTools = vi.fn();

vi.mock('@/lib/pi-integration/mcporter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pi-integration/mcporter')>('@/lib/pi-integration/mcporter');
  return {
    ...actual,
    listMcporterServers,
    listMcporterTools,
  };
});

beforeEach(() => {
  vi.resetModules();
  listMcporterServers.mockReset();
  listMcporterTools.mockReset();
});

describe('getRequestScopedTools', () => {
  it('returns base tools when mcporter discovery fails', async () => {
    listMcporterServers.mockRejectedValue(new Error('mcporter unavailable'));

    const mod = await import('@/lib/agent/tools');
    const tools = await mod.getRequestScopedTools();

    expect(tools.map((tool) => tool.name)).toContain('list_files');
    expect(tools.some((tool) => tool.name.startsWith('mcp__'))).toBe(false);
  });

  it('injects dynamic mcporter tools for healthy servers', async () => {
    listMcporterServers.mockResolvedValue({
      servers: [
        { name: 'context7', status: 'ok' },
        { name: 'offline-one', status: 'offline' },
      ],
    });
    listMcporterTools.mockResolvedValue({
      name: 'context7',
      status: 'ok',
      tools: [
        {
          name: 'resolve-library-id',
          description: 'Resolve a library id',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });

    const mod = await import('@/lib/agent/tools');
    const tools = await mod.getRequestScopedTools();
    const dynamicTool = tools.find((tool) => tool.name === 'mcp__context7__resolve_library_id');

    expect(dynamicTool).toBeDefined();
    expect(dynamicTool?.label).toContain('context7');
    expect(listMcporterTools).toHaveBeenCalledTimes(1);
    expect(listMcporterTools).toHaveBeenCalledWith('context7');
  });
});
