import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getPlatformConfig = vi.fn();
const dispatchFeishuWebhook = vi.fn();

vi.mock('@/lib/im/config', () => ({
  getPlatformConfig,
}));

vi.mock('@/lib/im/feishu-dispatcher', () => ({
  dispatchFeishuWebhook,
}));

async function importRoute() {
  return await import('../../app/api/im/webhook/feishu/route');
}

describe('POST /api/im/webhook/feishu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when Feishu is not configured', async () => {
    getPlatformConfig.mockReturnValue(undefined);

    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/webhook/feishu', {
      method: 'POST',
      body: JSON.stringify({ challenge: 'abc' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Feishu is not configured' });
  });

  it('delegates webhook protocol handling to the SDK dispatcher wrapper', async () => {
    getPlatformConfig.mockReturnValue({
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: { enabled: true, encrypt_key: 'encrypt', public_base_url: 'https://mindos.example.com' },
    });

    dispatchFeishuWebhook.mockResolvedValue({
      body: { challenge: 'challenge-token' },
      status: 200,
    });

    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/webhook/feishu', {
      method: 'POST',
      body: JSON.stringify({ challenge: 'challenge-token' }),
      headers: {
        'content-type': 'application/json',
        'x-lark-request-timestamp': '1',
      },
    });

    const res = await POST(req);
    expect(dispatchFeishuWebhook).toHaveBeenCalledWith({
      config: expect.objectContaining({ app_id: 'cli_xxx' }),
      body: { challenge: 'challenge-token' },
      headers: expect.objectContaining({
        'content-type': 'application/json',
        'x-lark-request-timestamp': '1',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'challenge-token' });
  });

  it('returns accepted when dispatcher queues an inbound event', async () => {
    getPlatformConfig.mockReturnValue({
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: { enabled: true, encrypt_key: 'encrypt', public_base_url: 'https://mindos.example.com' },
    });

    dispatchFeishuWebhook.mockResolvedValue({
      body: { ok: true, queued: true },
      status: 202,
    });

    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/im/webhook/feishu', {
      method: 'POST',
      body: JSON.stringify({ event: { message: { content: '{"text":"hi"}' } } }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, queued: true });
  });
});
