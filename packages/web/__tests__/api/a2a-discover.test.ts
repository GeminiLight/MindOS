import { beforeEach, describe, expect, it, vi } from 'vitest';

const discoverAgent = vi.fn();

vi.mock('@/lib/a2a/client', () => ({
  discoverAgent,
}));

async function importRoute() {
  return await import('../../app/api/a2a/discover/route');
}

function postDiscover(url: unknown) {
  return new Request('http://localhost/api/a2a/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

describe('POST /api/a2a/discover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks private-network discovery before calling the A2A client', async () => {
    const { POST } = await importRoute();

    const response = await POST(postDiscover('http://127.0.0.1:3456'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'A2A blocks localhost and private-network hosts unless MINDOS_A2A_ALLOW_PRIVATE_NETWORK=1.',
      agent: null,
    });
    expect(discoverAgent).not.toHaveBeenCalled();
  });

  it('normalizes public discovery URLs before delegating to the product handler', async () => {
    discoverAgent.mockResolvedValue({ id: 'agent-1', endpoint: 'https://agent.example/api/a2a' });
    const { POST } = await importRoute();

    const response = await POST(postDiscover('https://agent.example///'));

    expect(response.status).toBe(200);
    expect(discoverAgent).toHaveBeenCalledWith('https://agent.example');
    expect(await response.json()).toEqual({
      agent: { id: 'agent-1', endpoint: 'https://agent.example/api/a2a' },
    });
  });
});
