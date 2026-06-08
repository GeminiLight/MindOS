import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
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

  it('peeks the version without rebuilding the file tree cache', async () => {
    fsMocks.peekTreeVersion.mockReturnValue(42);
    fsMocks.getTreeVersion.mockImplementation(() => {
      throw new Error('getTreeVersion should not be called by the polling route');
    });

    const { GET } = await import('../../app/api/tree-version/route');
    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ v: 42 });
    expect(fsMocks.peekTreeVersion).toHaveBeenCalledTimes(1);
    expect(fsMocks.getTreeVersion).not.toHaveBeenCalled();
  });
});
