import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateRemoteWebSession,
  MINDOS_SESSION_COOKIE_NAME,
  persistRemoteAuthSessionCookie,
  type RemoteCookieStore,
} from './remote-auth';

function headersWithSetCookie(cookie: string | null) {
  return {
    get: (name: string) => (name.toLowerCase() === 'set-cookie' ? cookie : null),
  };
}

function fakeCookieStore() {
  const set = vi.fn<RemoteCookieStore['set']>(async () => {});
  return { set };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('authenticateRemoteWebSession', () => {
  it('posts the password and persists the returned MindOS session cookie', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00Z'));

    const cookieStore = fakeCookieStore();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: headersWithSetCookie(
        `${MINDOS_SESSION_COOKIE_NAME}=jwt-token; HttpOnly; SameSite=Lax; Max-Age=604800; Path=/`,
      ),
    }));

    const result = await authenticateRemoteWebSession({
      serverUrl: 'https://mindos.example',
      password: 'secret',
      cookieStore,
      fetchFn,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://mindos.example/api/auth',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'secret' }),
      }),
    );
    expect(cookieStore.set).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://mindos.example',
      name: MINDOS_SESSION_COOKIE_NAME,
      value: 'jwt-token',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expirationDate: Math.floor(Date.now() / 1000) + 604800,
    }));
  });

  it('fails closed when auth succeeds without a MindOS session cookie', async () => {
    const cookieStore = fakeCookieStore();
    const result = await authenticateRemoteWebSession({
      serverUrl: 'http://localhost:4567',
      password: 'secret',
      cookieStore,
      fetchFn: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: headersWithSetCookie('other=value; Path=/'),
      })),
    });

    expect(result).toEqual({
      ok: false,
      error: 'Auth succeeded but the MindOS session cookie was missing',
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('returns the existing incorrect-password error on non-2xx responses', async () => {
    const result = await authenticateRemoteWebSession({
      serverUrl: 'http://localhost:4567',
      password: 'wrong',
      cookieStore: fakeCookieStore(),
      fetchFn: vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: headersWithSetCookie(null),
      })),
    });

    expect(result).toEqual({ ok: false, error: 'Incorrect password', status: 401 });
  });

  it('aborts stalled auth requests instead of hanging startup', async () => {
    vi.useFakeTimers();
    const cookieStore = fakeCookieStore();
    const fetchFn = vi.fn((_url: string, init: RequestInit) => new Promise<never>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const promise = authenticateRemoteWebSession({
      serverUrl: 'http://localhost:4567',
      password: 'secret',
      cookieStore,
      fetchFn,
      timeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toEqual({
      ok: false,
      error: 'Auth request timed out',
      timedOut: true,
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe('persistRemoteAuthSessionCookie', () => {
  it('supports Fetch implementations that expose getSetCookie()', async () => {
    const cookieStore = fakeCookieStore();
    const persisted = await persistRemoteAuthSessionCookie(
      'https://mindos.example',
      {
        get: () => null,
        getSetCookie: () => [
          'other=value; Path=/',
          `${MINDOS_SESSION_COOKIE_NAME}=token; HttpOnly; Secure; SameSite=None; Path=/`,
        ],
      },
      cookieStore,
    );

    expect(persisted).toBe(true);
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(cookieStore.set).toHaveBeenCalledWith(expect.objectContaining({
      name: MINDOS_SESSION_COOKIE_NAME,
      value: 'token',
      secure: true,
      sameSite: 'no_restriction',
    }));
  });
});
