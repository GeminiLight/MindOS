import { timingSafeEqual } from 'node:crypto';
import type { MindosRouteAuth, MindosRouteAuthGuard } from './route-table.js';
import type { MindosHttpServices } from './services.js';

export function readAuthToken(services: Pick<MindosHttpServices, 'readSettings'>): string {
  try {
    const settings = services.readSettings();
    if (typeof settings.authToken === 'string') return settings.authToken;
  } catch {
    // Fall through to environment fallback.
  }
  return process.env.MINDOS_AUTH_TOKEN || process.env.AUTH_TOKEN || '';
}

export function readWebPassword(services: Pick<MindosHttpServices, 'readSettings'>): string {
  try {
    const settings = services.readSettings();
    if (typeof settings.webPassword === 'string' && settings.webPassword) return settings.webPassword;
  } catch {
    // Fall through to environment fallback.
  }
  return process.env.WEB_PASSWORD || '';
}

export type AuthorizationInput = {
  auth: MindosRouteAuth;
  headers: Headers;
  services: Pick<MindosHttpServices, 'readSettings'>;
};

/**
 * Contract auth for one request. Public routes always pass. For protected
 * routes: no token means the deployment is open unless a Web password exists
 * (then the API fails closed, because this server has no session mechanism to
 * honour the password); with a token, a same-origin browser request is trusted
 * only while no Web password exists; otherwise a constant-time bearer match.
 */
export function isAuthorizedRequest({ auth, headers, services }: AuthorizationInput): boolean {
  if (auth !== 'required') return true;

  const token = readAuthToken(services);
  if (!token) return !readWebPassword(services);

  if (!readWebPassword(services) && headers.get('sec-fetch-site') === 'same-origin') return true;

  const match = /^Bearer\s+(.+)$/i.exec(headers.get('authorization') ?? '');
  const candidate = match?.[1];
  return typeof candidate === 'string' && safeTokenEquals(candidate, token);
}

/** Auth level for a request that matched no route: guarded prefixes stay `required`, everything else is public (→ 404). */
export function resolveGuardedAuth(method: string, pathname: string, guards: MindosRouteAuthGuard[]): MindosRouteAuth {
  for (const guard of guards) {
    if ((guard.methods as string[]).includes(method) && pathname.startsWith(guard.prefix)) return guard.auth;
  }
  return 'public';
}

export function safeTokenEquals(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
