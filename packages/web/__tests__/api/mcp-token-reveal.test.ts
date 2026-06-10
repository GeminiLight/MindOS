import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ authToken: 'route-token-secret' }),
}));

describe('POST /api/mcp/token/reveal', () => {
  it('returns the full MCP token only from the explicit reveal endpoint', async () => {
    const { POST } = await import('../../app/api/mcp/token/reveal/route');

    const res = await POST();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({
      authConfigured: true,
      authToken: 'route-token-secret',
    });
  });
});
