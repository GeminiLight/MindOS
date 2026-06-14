import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyJwt } from '@/lib/jwt';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resetRuntimeAuthConfigCacheForTests } from '@/lib/runtime-auth-config';

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
  const originalWebSessionSecret = process.env.WEB_SESSION_SECRET;
  const originalHome = process.env.HOME;
  let tempHome = '';

  function writeConfig(config: Record<string, unknown>) {
    const dir = path.join(tempHome, '.mindos');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), 'utf-8');
    resetRuntimeAuthConfigCacheForTests();
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-web-auth-'));
    process.env.HOME = tempHome;
    delete process.env.WEB_PASSWORD;
    delete process.env.WEB_SESSION_SECRET;
    resetRuntimeAuthConfigCacheForTests();
  });

  afterEach(() => {
    if (originalWebPassword === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = originalWebPassword;
    if (originalWebSessionSecret === undefined) delete process.env.WEB_SESSION_SECRET;
    else process.env.WEB_SESSION_SECRET = originalWebSessionSecret;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
    resetRuntimeAuthConfigCacheForTests();
  });

  it('rejects requests when no Web password is configured', async () => {
    const { POST } = await import('@/app/api/auth/route');

    const res = await POST(makeAuthRequest({ password: 'secret' }));

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('accepts the persisted Web password when WEB_PASSWORD is not configured', async () => {
    writeConfig({ webPassword: 'persisted-secret', webSessionSecret: 'persisted-session-secret' });
    const { POST } = await import('@/app/api/auth/route');

    const res = await POST(makeAuthRequest({ password: 'persisted-secret' }));
    const setCookie = res.headers.get('set-cookie') ?? '';
    const token = parseCookieValue(setCookie, 'mindos-session');
    const payload = await verifyJwt(token, 'persisted-session-secret');

    expect(res.status).toBe(200);
    expect(payload?.sub).toBe('user');
    expect(await verifyJwt(token, 'persisted-secret')).toBeNull();
  });

  it('keeps WEB_PASSWORD ahead of the persisted Web password', async () => {
    writeConfig({ webPassword: 'persisted-secret', webSessionSecret: 'persisted-session-secret' });
    process.env.WEB_PASSWORD = 'env-secret';
    process.env.WEB_SESSION_SECRET = 'env-session-secret';
    const { POST } = await import('@/app/api/auth/route');

    const persistedRes = await POST(makeAuthRequest({ password: 'persisted-secret' }));
    const envRes = await POST(makeAuthRequest({ password: 'env-secret' }));
    const token = parseCookieValue(envRes.headers.get('set-cookie') ?? '', 'mindos-session');

    expect(persistedRes.status).toBe(401);
    expect(envRes.status).toBe(200);
    expect(await verifyJwt(token, 'env-session-secret')).not.toBeNull();
    expect(await verifyJwt(token, 'persisted-session-secret')).toBeNull();
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
    process.env.WEB_SESSION_SECRET = 'stable-session-secret';
    const { POST } = await import('@/app/api/auth/route');

    const res = await POST(makeAuthRequest({ password: 'secret' }));
    const setCookie = res.headers.get('set-cookie') ?? '';
    const token = parseCookieValue(setCookie, 'mindos-session');
    const payload = await verifyJwt(token, 'stable-session-secret');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(payload?.sub).toBe('user');
    expect(await verifyJwt(token, 'secret')).toBeNull();
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
