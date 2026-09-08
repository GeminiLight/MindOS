/**
 * Pure helpers for the MCP Streamable HTTP transport's network exposure and
 * bearer authentication.
 *
 * Kept free of Express / MCP SDK imports so the rules are unit-testable and
 * reusable by the launchers that compute MCP_HOST (CLI `mindos start`, the
 * Web `mcp/restart` handler, Desktop ProcessManager).
 */

import { timingSafeEqual } from 'node:crypto';

export const MCP_LOOPBACK_HOST = '127.0.0.1';
export const MCP_ANY_HOST = '0.0.0.0';

export type McpBindHostDecision = {
  /** Host the HTTP server should actually bind to. */
  host: string;
  /** True when a non-loopback host was requested but forced back to loopback. */
  forcedLoopback: boolean;
  /** The host the caller asked for, if any (trimmed). */
  requestedHost?: string;
};

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return false;
  if (value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (value.startsWith('::ffff:127.')) return true;
  return false;
}

/**
 * Decide which interface the MCP HTTP server may bind to.
 *
 * Auth is only enforced when a bearer token is configured, so an
 * unauthenticated server must never leave loopback regardless of what
 * MCP_HOST asks for. With a token, the requested host (default 0.0.0.0) wins.
 */
export function resolveMcpBindHost(
  requestedHost: string | null | undefined,
  authToken: string | null | undefined,
): McpBindHostDecision {
  const requested = typeof requestedHost === 'string' && requestedHost.trim() ? requestedHost.trim() : undefined;
  const authenticated = typeof authToken === 'string' && authToken.length > 0;

  if (authenticated) {
    return { host: requested ?? MCP_ANY_HOST, forcedLoopback: false, requestedHost: requested };
  }
  if (!requested) {
    return { host: MCP_LOOPBACK_HOST, forcedLoopback: false };
  }
  if (isLoopbackHost(requested)) {
    return { host: requested, forcedLoopback: false, requestedHost: requested };
  }
  return { host: MCP_LOOPBACK_HOST, forcedLoopback: true, requestedHost: requested };
}

export function formatForcedLoopbackWarning(decision: McpBindHostDecision): string | null {
  if (!decision.forcedLoopback) return null;
  return `[MCP] AUTH_TOKEN is not set; refusing to bind MCP HTTP to ${decision.requestedHost} and using ${decision.host} instead. `
    + 'Set an auth token (mindos onboard) to expose MCP on the network.';
}

/** Strict `Authorization: Bearer <token>` parser. Returns null for anything else. */
export function parseBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  return token && token.length > 0 ? token : null;
}

/**
 * Constant-time bearer comparison. Length mismatches are rejected up front
 * because `timingSafeEqual` requires equal-length buffers.
 */
export function isAuthorizedBearer(header: unknown, expectedToken: string | null | undefined): boolean {
  if (typeof expectedToken !== 'string' || expectedToken.length === 0) return false;
  const presented = parseBearerToken(header);
  if (presented === null) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expectedToken, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Hostnames a loopback-bound MCP server accepts in the `Host` header (DNS-rebinding protection). */
export const MCP_LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

export type HostHeaderValidation =
  | { ok: true; hostname: string }
  | { ok: false; message: string };

/**
 * Mirrors the MCP SDK's Express `localhostHostValidation`: the Host header is
 * parsed with the URL API (so ports and IPv6 brackets are handled) and its
 * hostname must be one of the loopback names. Only applied when the server is
 * bound to loopback, where a browser reaching it via a rebound DNS name is the
 * realistic attack.
 */
export function validateLocalhostHostHeader(
  hostHeader: string | null | undefined,
  allowedHostnames: readonly string[] = MCP_LOCALHOST_HOSTNAMES,
): HostHeaderValidation {
  if (!hostHeader) return { ok: false, message: 'Missing Host header' };
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return { ok: false, message: `Invalid Host header: ${hostHeader}` };
  }
  if (!allowedHostnames.includes(hostname)) return { ok: false, message: `Invalid Host: ${hostname}` };
  return { ok: true, hostname };
}
