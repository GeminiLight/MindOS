import type { CookiesSetDetails } from 'electron';

export const REMOTE_AUTH_TIMEOUT_MS = 8_000;
export const MINDOS_SESSION_COOKIE_NAME = 'mindos-session';

export type RemoteAuthResult =
  | { ok: true }
  | { ok: false; error: string; timedOut?: boolean; status?: number };

export interface RemoteCookieStore {
  set(details: CookiesSetDetails): Promise<void>;
}

interface AuthHeadersLike {
  get(name: string): string | null;
  getSetCookie?: () => string[];
  raw?: () => Record<string, string[] | undefined>;
}

interface AuthResponseLike {
  ok: boolean;
  status?: number;
  headers: AuthHeadersLike;
}

type FetchLike = (input: string, init: RequestInit) => Promise<AuthResponseLike>;

export interface AuthenticateRemoteWebSessionOptions {
  serverUrl: string;
  password: string;
  cookieStore: RemoteCookieStore;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function getSetCookieHeaders(headers: AuthHeadersLike): string[] {
  const direct = headers.getSetCookie?.();
  if (Array.isArray(direct) && direct.length > 0) return direct;

  const raw = headers.raw?.()['set-cookie'];
  if (Array.isArray(raw) && raw.length > 0) return raw;

  const single = headers.get('set-cookie');
  return single ? splitCombinedSetCookieHeader(single) : [];
}

function splitCombinedSetCookieHeader(value: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const rest = value.slice(i).toLowerCase();
    if (rest.startsWith('expires=')) inExpires = true;
    if (inExpires && char === ';') inExpires = false;
    if (char === ',' && !inExpires) {
      cookies.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }

  const last = value.slice(start).trim();
  if (last) cookies.push(last);
  return cookies.filter(Boolean);
}

function parseSameSite(value: string): CookiesSetDetails['sameSite'] {
  const normalized = value.toLowerCase();
  if (normalized === 'none') return 'no_restriction';
  if (normalized === 'lax') return 'lax';
  if (normalized === 'strict') return 'strict';
  return 'unspecified';
}

function parseMindosSessionCookie(serverUrl: string, header: string, nowMs: number): CookiesSetDetails | null {
  const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
  const [nameValue, ...attributes] = parts;
  if (!nameValue) return null;

  const separatorIndex = nameValue.indexOf('=');
  if (separatorIndex <= 0) return null;

  const name = nameValue.slice(0, separatorIndex);
  if (name !== MINDOS_SESSION_COOKIE_NAME) return null;

  const cookie: CookiesSetDetails = {
    url: new URL(serverUrl).origin,
    name,
    value: nameValue.slice(separatorIndex + 1),
    path: '/',
    sameSite: 'unspecified',
  };

  for (const attribute of attributes) {
    const eqIndex = attribute.indexOf('=');
    const rawKey = eqIndex === -1 ? attribute : attribute.slice(0, eqIndex);
    const rawValue = eqIndex === -1 ? '' : attribute.slice(eqIndex + 1);
    const key = rawKey.toLowerCase();

    if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'path' && rawValue) cookie.path = rawValue;
    else if (key === 'domain' && rawValue) cookie.domain = rawValue;
    else if (key === 'samesite' && rawValue) cookie.sameSite = parseSameSite(rawValue);
    else if (key === 'max-age') {
      const seconds = Number.parseInt(rawValue, 10);
      if (Number.isFinite(seconds)) cookie.expirationDate = Math.floor(nowMs / 1000) + seconds;
    } else if (key === 'expires' && rawValue) {
      const expiresMs = Date.parse(rawValue);
      if (Number.isFinite(expiresMs)) cookie.expirationDate = Math.floor(expiresMs / 1000);
    }
  }

  return cookie;
}

export async function persistRemoteAuthSessionCookie(
  serverUrl: string,
  headers: AuthHeadersLike,
  cookieStore: RemoteCookieStore,
  nowMs = Date.now(),
): Promise<boolean> {
  const setCookieHeaders = getSetCookieHeaders(headers);
  const sessionCookies = setCookieHeaders
    .map((header) => parseMindosSessionCookie(serverUrl, header, nowMs))
    .filter((cookie): cookie is CookiesSetDetails => cookie !== null);

  if (sessionCookies.length === 0) return false;

  for (const cookie of sessionCookies) {
    await cookieStore.set(cookie);
  }
  return true;
}

export async function authenticateRemoteWebSession({
  serverUrl,
  password,
  cookieStore,
  fetchFn = fetch as FetchLike,
  timeoutMs = REMOTE_AUTH_TIMEOUT_MS,
}: AuthenticateRemoteWebSessionOptions): Promise<RemoteAuthResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${serverUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      return { ok: false, error: 'Incorrect password', status: res.status };
    }

    const persisted = await persistRemoteAuthSessionCookie(serverUrl, res.headers, cookieStore);
    if (!persisted) {
      return { ok: false, error: 'Auth succeeded but the MindOS session cookie was missing' };
    }

    return { ok: true };
  } catch (err) {
    if (isAbortError(err)) return { ok: false, error: 'Auth request timed out', timedOut: true };
    return { ok: false, error: `Auth failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}
