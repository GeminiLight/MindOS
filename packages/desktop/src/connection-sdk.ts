/**
 * Shared connection SDK for MindOS clients (Electron, Capacitor, Browser).
 * Zero DOM dependency — only uses fetch (available in Node 22+, browsers, Capacitor, Electron).
 */

/**
 * Stable failure codes. The renderer maps these to localized strings (see
 * i18n/index.translateFailure) — raw English fetch errors used to leak straight
 * into the Chinese connect UI.
 */
export type ConnectErrorCode =
  | 'errEmptyAddress'
  | 'errInvalidAddress'
  | 'errTimeout'
  | 'errRefused'
  | 'errHttpStatus';

/** Health check result from testConnection() */
export interface HealthCheckResult {
  status: 'online' | 'offline' | 'not-mindos' | 'error';
  version?: string;
  authRequired?: boolean;
  /** Localizable failure code — prefer this over `error` when rendering. */
  code?: ConnectErrorCode;
  params?: Record<string, string | number>;
  /** Raw diagnostic text; kept for logs and as a last-resort fallback. */
  error?: string;
}

/** Persisted connection record */
export interface SavedConnection {
  address: string;         // e.g. http://192.168.1.100:3456
  label?: string;          // User-defined label
  lastConnected: string;   // ISO 8601
  authMethod: 'password' | 'token';
}

/**
 * Normalize a server address:
 * - Trim whitespace
 * - Remove trailing slashes
 * - Prepend http:// if no protocol
 * - Preserve https://
 * - Handle IPv6 brackets
 */
export function normalizeAddress(input: string): string {
  let addr = input.trim().replace(/\/+$/, '');
  if (!addr) return '';
  if (!/^https?:\/\//.test(addr)) {
    addr = `http://${addr}`;
  }
  // Validate URL structure
  try {
    new URL(addr);
  } catch {
    return '';
  }
  return addr;
}

/**
 * Test connection to a MindOS server.
 * Calls GET {address}/api/health with a 5-second timeout.
 */
export async function testConnection(address: string): Promise<HealthCheckResult> {
  if (!address.trim()) return { status: 'error', code: 'errEmptyAddress', error: 'Empty address' };
  const url = normalizeAddress(address);
  if (!url) return { status: 'error', code: 'errInvalidAddress', error: 'Invalid address' };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    const res = await fetch(`${url}/api/health`, {
      signal: ctrl.signal,
      cache: 'no-store',
    } as RequestInit);
    clearTimeout(timer);

    if (!res.ok) {
      return {
        status: 'error',
        code: 'errHttpStatus',
        params: { status: res.status },
        error: `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      ok?: boolean;
      service?: string;
      version?: string;
      authRequired?: boolean;
    };
    if (data.ok !== true || data.service !== 'mindos') {
      return { status: 'not-mindos' };
    }

    return {
      status: 'online',
      version: data.version,
      authRequired: data.authRequired,
    };
  } catch (err: unknown) {
    // AbortError arrives as a DOMException in browsers and (depending on the
    // runtime) may not extend Error — match on `name` rather than the class.
    const name = (err as { name?: unknown } | null)?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { status: 'offline', code: 'errTimeout', error: 'Connection timed out' };
    }
    return {
      status: 'offline',
      code: 'errRefused',
      error: err instanceof Error ? err.message : 'Connection refused',
    };
  }
}
