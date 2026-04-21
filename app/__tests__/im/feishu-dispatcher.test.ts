import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeishuConfig } from '@/lib/im/types';

const { dispatcherInvoke, dispatcherConstruct, generateChallenge } = vi.hoisted(() => {
  const dispatcherInvoke = vi.fn();
  const dispatcherConstruct = vi.fn();
  const generateChallenge = vi.fn();
  return { dispatcherInvoke, dispatcherConstruct, generateChallenge };
});

vi.mock('@larksuiteoapi/node-sdk', () => ({
  EventDispatcher: class MockEventDispatcher {
    constructor(params: unknown) {
      dispatcherConstruct(params);
    }

    register() {
      return this;
    }

    async invoke(data: unknown) {
      return await dispatcherInvoke(data);
    }
  },
  generateChallenge,
}));

describe('Feishu dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateChallenge.mockReturnValue({ isChallenge: false, challenge: undefined });
  });

  it('returns ignored when webhook is not ready', async () => {
    const { dispatchFeishuWebhook } = await import('@/lib/im/feishu-dispatcher');
    const config: FeishuConfig = {
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: {
        enabled: true,
        encrypt_key: 'encrypt',
      },
    };

    const result = await dispatchFeishuWebhook({
      config,
      body: { event: { message: { content: '{"text":"hi"}' } } },
      headers: {},
    });

    expect(result).toEqual({
      status: 202,
      body: { ok: false, ignored: true, reason: 'Public base URL is required for Feishu event callbacks.' },
    });
  }, 10000);

  it('returns challenge response using SDK helper', async () => {
    const { dispatchFeishuWebhook } = await import('@/lib/im/feishu-dispatcher');
    generateChallenge.mockReturnValue({
      isChallenge: true,
      challenge: { challenge: 'challenge-token' },
    });

    const result = await dispatchFeishuWebhook({
      config: {
        app_id: 'cli_xxx',
        app_secret: 'secret',
        conversation: {
          enabled: true,
          encrypt_key: 'encrypt',
          public_base_url: 'https://mindos.example.com',
          verification_token: 'verification-token',
        },
      },
      body: { challenge: 'challenge-token' },
      headers: { 'x-lark-request-timestamp': '1' },
    });

    expect(generateChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ challenge: 'challenge-token' }),
      { encryptKey: 'encrypt' },
    );
    expect(dispatcherInvoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 200,
      body: { challenge: 'challenge-token' },
    });
  });

  it('returns 401 when SDK verification fails', async () => {
    const { dispatchFeishuWebhook } = await import('@/lib/im/feishu-dispatcher');
    dispatcherInvoke.mockResolvedValue(undefined);

    const result = await dispatchFeishuWebhook({
      config: {
        app_id: 'cli_xxx',
        app_secret: 'secret',
        conversation: {
          enabled: true,
          encrypt_key: 'encrypt',
          public_base_url: 'https://mindos.example.com',
          verification_token: 'verification-token',
        },
      },
      body: { schema: '2.0', header: { event_type: 'im.message.receive_v1' } },
      headers: {
        'x-lark-request-timestamp': '1',
        'x-lark-request-nonce': 'nonce',
        'x-lark-signature': 'bad-signature',
      },
    });

    expect(result).toEqual({
      status: 401,
      body: { ok: false, error: 'Invalid Feishu webhook signature or payload.' },
    });
  });

  it('uses SDK dispatcher and returns the handler response for accepted events', async () => {
    const { dispatchFeishuWebhook } = await import('@/lib/im/feishu-dispatcher');
    dispatcherInvoke.mockResolvedValue({ ok: true, queued: true, reason: 'direct_message' });

    const result = await dispatchFeishuWebhook({
      config: {
        app_id: 'cli_xxx',
        app_secret: 'secret',
        conversation: {
          enabled: true,
          encrypt_key: 'encrypt',
          public_base_url: 'https://mindos.example.com',
          verification_token: 'verification-token',
        },
      },
      body: { schema: '2.0', header: { event_type: 'im.message.receive_v1' } },
      headers: {
        'x-lark-request-timestamp': '1',
        'x-lark-request-nonce': 'nonce',
        'x-lark-signature': 'signature',
      },
    });

    expect(dispatcherInvoke).toHaveBeenCalledWith(expect.objectContaining({
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1' },
    }));
    expect(result).toEqual({
      status: 202,
      body: { ok: true, queued: true, reason: 'direct_message' },
    });
  });
});
