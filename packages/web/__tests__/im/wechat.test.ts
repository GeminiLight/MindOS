import { describe, expect, it, vi, afterEach } from 'vitest';
import { WeChatAdapter } from '@/lib/im/adapters/wechat';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('WeChatAdapter', () => {
  it('verify returns false when getme times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request timed out')));
    const adapter = new WeChatAdapter({ bot_token: 'wx-bot-token' });
    await expect(adapter.verify()).resolves.toBe(false);
  });

  it('send reports timeout error clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request timed out')));
    const adapter = new WeChatAdapter({ bot_token: 'wx-bot-token' });
    const result = await adapter.send({ platform: 'wechat', recipientId: 'chat1', text: 'hello' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
  });
});
