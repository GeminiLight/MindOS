import { describe, expect, it, vi, afterEach } from 'vitest';
import { DingTalkAdapter } from '@/lib/im/adapters/dingtalk';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DingTalkAdapter', () => {
  it('verify returns false when token refresh times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request timed out')));
    const adapter = new DingTalkAdapter({ client_id: 'ding-app', client_secret: 'ding-secret' });
    await expect(adapter.verify()).resolves.toBe(false);
  });

  it('send reports timeout error clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request timed out')));
    const adapter = new DingTalkAdapter({ webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=abc' });
    const result = await adapter.send({ platform: 'dingtalk', recipientId: 'chat1', text: 'hello' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
  });
});
