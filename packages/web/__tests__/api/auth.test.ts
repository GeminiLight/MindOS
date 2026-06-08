import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyJwt } from '@/lib/jwt';

function makeAuthRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function parseCookieValue(setCookie: string, name: string): string {
  const firstPart = setCookie.split(';')[0] ?? '';
  const [cookieName, value] = firstPart.split('=');
  if (cookieName !== name || !value) throw new Error(`Cookie ${name} not found`);
  return value;
}

describe('POST /api/auth', () => {
  const originalWebPassword = process.env.WEB_PASSWORD;

  afterEach(() => {
    if (originalWebPassword === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = originalWebPassword;
  });

  it('rejects requests when WEB_PASSWORD is not configured', async () => {
    delete process.env.WEB_PASSWORD;
    const { POST } = await import('@/app/api/auth/route');

    const res = await POST(makeAuthRequest({ password: 'secret' }));

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects malformed request bodies', async () => {
    process.env.WEB_PASSWORD = 'secret';
    const { POST } = await import('@/app/api/auth/route');
    const req = new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken json',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request body' });
  });

  it('rejects wrong passwords without setting a session cookie', async () => {
    process.env.WEB_PASSWORD = 'secret';
    const { POST } = await import('@/app/api/auth/route');

    const res = await POST(makeAuthRequest({ password: 'wrong' }));

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sets a signed HttpOnly Web session cookie for the correct password', async () => {
    process.env.WEB_PASSWORD = 'secret';
    const { POST } = await import('@/app/api/auth/route');

    const res = await POST(makeAuthRequest({ password: 'secret' }));
    const setCookie = res.headers.get('set-cookie') ?? '';
    const token = parseCookieValue(setCookie, 'mindos-session');
    const payload = await verifyJwt(token, 'secret');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(payload?.sub).toBe('user');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=604800');
    expect(setCookie).toContain('Path=/');
  });

  it('uses SameSite=None and Secure for allowed HTTPS cross-origin auth', async () => {
    process.env.WEB_PASSWORD = 'secret';
    const { POST } = await import('@/app/api/auth/route');

    const res = await POST(makeAuthRequest(
      { password: 'secret' },
      {
        origin: 'https://localhost:1234',
        'x-forwarded-proto': 'https',
      },
    ));

    expect(res.headers.get('set-cookie')).toContain('SameSite=None');
    expect(res.headers.get('set-cookie')).toContain('Secure');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost:1234');
  });
});

describe('DELETE /api/auth', () => {
  it('clears the Web session cookie', async () => {
    const { DELETE } = await import('@/app/api/auth/route');

    const res = await DELETE(new NextRequest('http://localhost/api/auth', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('mindos-session=');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
