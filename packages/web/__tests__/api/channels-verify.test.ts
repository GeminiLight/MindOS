import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const verifyIMCredentials = vi.fn();

vi.mock('@/lib/im/verify', () => ({
  verifyIMCredentials,
}));

async function importRoute() {
  return await import('../../app/api/channels/verify/route');
}

function makeReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/channels/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/channels/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid platform', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ platform: 'unknown', credentials: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Invalid platform' });
  });

  it('rejects missing credentials', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ platform: 'telegram' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Missing credentials' });
  });

  it('rejects invalid credential shape before verification', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ platform: 'telegram', credentials: { bot_token: 'bad' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Missing required fields: bot_token' });
    expect(verifyIMCredentials).not.toHaveBeenCalled();
  });

  it('returns verified bot identity on success', async () => {
    verifyIMCredentials.mockResolvedValue({ ok: true, botName: 'MyBot', botId: '123' });
    const { POST } = await importRoute();
    const res = await POST(makeReq({
      platform: 'telegram',
      credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, botName: 'MyBot', botId: '123' });
    expect(verifyIMCredentials).toHaveBeenCalledWith('telegram', {
      bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
    });
  });

  it('returns 401 when verification fails', async () => {
    verifyIMCredentials.mockResolvedValue({ ok: false, error: 'Unauthorized: check bot_token' });
    const { POST } = await importRoute();
    const res = await POST(makeReq({
      platform: 'telegram',
      credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
    }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized: check bot_token' });
  });
});
