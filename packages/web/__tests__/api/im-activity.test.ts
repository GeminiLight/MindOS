import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getActivities = vi.fn();

vi.mock('@/lib/im/activity', () => ({
  getActivities,
}));

async function importRoute() {
  return await import('../../app/api/im/activity/route');
}

describe('GET /api/im/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid platform', async () => {
    const { GET } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/activity?platform=bad');
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid or missing platform parameter' });
  });

  it('returns activities with clamped limit', async () => {
    getActivities.mockReturnValue([{ id: '1', platform: 'feishu', type: 'test', status: 'success', recipient: 'ou_1', messageSummary: 'hello', timestamp: '2026-04-10T00:00:00.000Z' }]);
    const { GET } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/activity?platform=feishu&limit=500');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(getActivities).toHaveBeenCalledWith('feishu', 100);
    expect(await res.json()).toEqual({ activities: expect.any(Array) });
  });
});
