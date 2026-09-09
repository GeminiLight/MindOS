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
  /**
   * Peer address of the TCP socket that carried the request (`incoming.socket.remoteAddress`).
   * Hosts without a socket (the Next proxy, `app.fetch(request)` in tests) leave it undefined
   * and the same-origin exemption falls back to the `Host` header alone.
   */
  remoteAddress?: string | null;
  services: Pick<MindosHttpServices, 'readSettings'>;
};

/**
 * Contract auth for one request. Public routes always pass. For protected
 * routes: no token means the deployment is open unless a Web password exists
 * (then the API fails closed, because this server has no session mechanism to
 * honour the password); with a token, a same-origin browser request is trusted
 * only while no Web password exists AND the browser is on this machine (see
 * `allowsSameOriginExemption`); otherwise a constant-time bearer match.
 */
export function isAuthorizedRequest({ auth, headers, remoteAddress, services }: AuthorizationInput): boolean {
  if (auth !== 'required') return true;

  const token = readAuthToken(services);
  if (!token) return !readWebPassword(services);

  if (
    !readWebPassword(services)
    && headers.get('sec-fetch-site') === 'same-origin'
    && allowsSameOriginExemption({ headers, remoteAddress })
  ) {
    return true;
  }

  const match = /^Bearer\s+(.+)$/i.exec(headers.get('authorization') ?? '');
  const candidate = match?.[1];
  return typeof candidate === 'string' && safeTokenEquals(candidate, token);
}

export type SameOriginExemptionInput = {
  headers: Headers;
  remoteAddress?: string | null;
};

/**
 * Whether a `Sec-Fetch-Site: same-origin` request may skip the bearer. The
 * header only proves "a browser page on this origin made the call"; when the
 * server listens on `0.0.0.0`, a LAN browser that loaded the UI qualifies too,
 * so the exemption is limited to the local machine:
 *
 * - forwarding headers (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`) can only
 *   deny: any hop that is not loopback (or cannot be parsed) means the real
 *   client is remote even though the socket peer may be a local reverse proxy.
 *   Next fills `X-Forwarded-For` from the socket itself, so a local browser
 *   behind the Next proxy still carries a loopback value here;
 * - a loopback socket peer is trusted;
 * - otherwise the `Host` header must name localhost / 127.0.0.1 / [::1], which
 *   keeps container / port-forward setups (bridged peer address) working.
 *
 * Behind a reverse proxy only clients the proxy reports as loopback keep the
 * exemption; every other client needs a token or a Web password.
 */
export function allowsSameOriginExemption({ headers, remoteAddress }: SameOriginExemptionInput): boolean {
  if (forwardedClientIsRemote(headers)) return false;
  if (isLoopbackAddress(remoteAddress)) return true;
  return isLoopbackHost(headers.get('host'));
}

/**
 * True when a forwarding header names a client that is not loopback (or that
 * cannot be parsed, e.g. `for=unknown`). Absent headers are not evidence of
 * anything and return false; a loopback-only chain also returns false.
 */
export function forwardedClientIsRemote(headers: Headers): boolean {
  const addresses = forwardedClientAddresses(headers);
  return addresses.some((address) => !isLoopbackAddress(address));
}

/** Every client address recorded by `X-Forwarded-For`, `Forwarded` (`for=`) and `X-Real-IP`, unparseable entries as `''`. */
export function forwardedClientAddresses(headers: Headers): string[] {
  const addresses: string[] = [];
  for (const entry of splitHeaderList(headers.get('x-forwarded-for'))) {
    addresses.push(normalizeForwardedNode(entry));
  }
  for (const element of splitHeaderList(headers.get('forwarded'))) {
    for (const pair of element.split(';')) {
      const [name, ...rest] = pair.split('=');
      if (name?.trim().toLowerCase() !== 'for') continue;
      addresses.push(normalizeForwardedNode(rest.join('=')));
    }
  }
  const realIp = headers.get('x-real-ip');
  if (realIp !== null && realIp.trim() !== '') addresses.push(normalizeForwardedNode(realIp));
  return addresses;
}

function splitHeaderList(value: string | null): string[] {
  if (value === null) return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
}

/** Strips quotes, brackets and an optional port from a `for=` node so it can be compared as an address. */
function normalizeForwardedNode(raw: string): string {
  let value = raw.trim().replace(/^"|"$/g, '').trim();
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? '' : value.slice(1, close);
  }
  // IPv4 (or hostname) with a port: exactly one colon.
  const colons = value.split(':').length - 1;
  if (colons === 1) value = value.slice(0, value.indexOf(':'));
  return value;
}

/** `127.0.0.0/8`, `::1` and IPv4-mapped `::ffff:127.x.x.x` (zone ids such as `%lo0` are ignored). */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (typeof address !== 'string') return false;
  let value = address.trim().toLowerCase();
  if (!value) return false;
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  if (value === '::1') return true;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    // Dotted-quad form (`::ffff:127.0.0.1`) or hex form (`::ffff:7f00:1`).
    if (mapped.includes('.')) return isLoopbackIpv4(mapped);
    return /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped);
  }
  return isLoopbackIpv4(value);
}

function isLoopbackIpv4(value: string): boolean {
  const octets = value.split('.');
  if (octets.length !== 4) return false;
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return false;
  return octets[0] === '127';
}

/** `localhost`, `127.0.0.1` or `[::1]`, each with an optional `:port`; case-insensitive. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (typeof host !== 'string') return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(host.trim());
  if (!match) return false;
  const port = match[2];
  return port === undefined || Number(port) <= 65535;
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
