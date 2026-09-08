/**
 * Browser origins allowed to call the MindOS API cross-origin with CORS.
 *
 * Shared by the request proxy (all `/api/*` responses) and the `/api/auth`
 * route so the two allowlists cannot drift. Local-network origins cover the
 * Web UI opened from another device, Capacitor / Electron remote shells, and
 * `file://` pages. Non-browser clients (curl, mobile app, MCP server) send no
 * Origin header and never need CORS; the browser extension fetches through
 * MV3 `host_permissions`, which exempts it from CORS as well.
 */
export const ALLOWED_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^capacitor:\/\//,
  /^file:\/\//,
];

export function isAllowedCorsOrigin(origin: string | null | undefined): origin is string {
  if (typeof origin !== 'string' || !origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}
