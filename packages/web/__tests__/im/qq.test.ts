import { describe, expect, it, vi, afterEach } from 'vitest';
import { QQAdapter } from '@/lib/im/adapters/qq';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('QQAdapter', () => {
  it('verify returns false when token request times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request timed out')));
    const adapter = new QQAdapter({ app_id: 'qq-app', app_secret: 'qq-secret' });
    await expect(adapter.verify()).resolves.toBe(false);
  });

  it('send reports timeout error clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request timed out')));
    const adapter = new QQAdapter({ app_id: 'qq-app', app_secret: 'qq-secret' });
    const result = await adapter.send({ platform: 'qq', recipientId: 'group:123', text: 'hello' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
  });
});
