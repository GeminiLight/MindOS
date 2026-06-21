import { describe, expect, it, vi, beforeEach } from 'vitest';

const createAgentCapabilitiesServices = vi.fn();

vi.mock('@/lib/agent/capability-registry', () => ({
  createAgentCapabilitiesServices,
}));

async function importRoute() {
  return await import('../../app/api/agent-capabilities/route');
}

describe('GET /api/agent-capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentCapabilitiesServices.mockReturnValue({
      kb: () => [{
        id: 'kb:read',
        kind: 'kb-tool',
        name: 'Read File',
        description: 'Read notes',
        source: 'mindos',
        status: 'available',
        permissionRequired: 'read',
      }],
      mcp: () => [{
        id: 'mcp:github:search_code',
        kind: 'mcp-tool',
        name: 'search_code',
        description: 'Search code',
        source: 'mcp',
        status: 'cached',
        permissionRequired: 'ask',
      }],
    });
  });

  it('returns capabilities from the product handler', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-capabilities?include=kb,mcp'));

    expect(res.status).toBe(200);
    expect(createAgentCapabilitiesServices).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({
      include: ['kb', 'mcp'],
      capabilities: [{
        id: 'kb:read',
        kind: 'kb-tool',
        source: 'mindos',
      }, {
        id: 'mcp:github:search_code',
        kind: 'mcp-tool',
        source: 'mcp',
      }],
      sources: [
        { id: 'kb', status: 'ok', count: 1 },
        { id: 'mcp', status: 'ok', count: 1 },
      ],
    });
  });

  it('rejects removed mode filter', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-capabilities?mode=organize'));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Unknown field: mode' });
  });
});
