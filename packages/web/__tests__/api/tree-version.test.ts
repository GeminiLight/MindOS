import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  invalidateCache: vi.fn(),
  getTreeVersion: vi.fn(),
  peekTreeVersion: vi.fn(),
}));

vi.mock('@/lib/fs', () => fsMocks);
vi.mock('@/lib/telemetry', () => ({
  telemetry: {
    startTimer: () => vi.fn(),
  },
}));

describe('GET /api/tree-version', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the TTL-aware tree version so watcher misses recover on the next poll', async () => {
    fsMocks.getTreeVersion.mockReturnValue(42);
    fsMocks.peekTreeVersion.mockReturnValue(7);

    const { GET } = await import('../../app/api/tree-version/route');
    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ v: 42 });
    expect(fsMocks.getTreeVersion).toHaveBeenCalledTimes(1);
    expect(fsMocks.peekTreeVersion).not.toHaveBeenCalled();
  });

  it('forces cache invalidation and rebuilds before returning the refreshed version', async () => {
    fsMocks.getTreeVersion.mockReturnValue(43);

    const { POST } = await import('../../app/api/tree-version/route');
    const res = POST();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ v: 43 });
    expect(fsMocks.invalidateCache).toHaveBeenCalledTimes(1);
    expect(fsMocks.getTreeVersion).toHaveBeenCalledTimes(1);
  });
});
