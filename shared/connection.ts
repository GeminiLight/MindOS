/**
 * Shared connection SDK for MindOS clients (Electron, Capacitor, Browser).
 * Zero DOM dependency — only uses fetch (available in Node 22+, browsers, Capacitor, Electron).
 */

/** Health check result from testConnection() */
export interface HealthCheckResult {
  status: 'online' | 'offline' | 'not-mindos' | 'error';
  version?: string;
  authRequired?: boolean;
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
  return addr;
}

/**
 * Test connection to a MindOS server.
 * Calls GET {address}/api/health with a 5-second timeout.
 */
export async function testConnection(address: string): Promise<HealthCheckResult> {
  const url = normalizeAddress(address);
  if (!url) return { status: 'error', error: 'Empty address' };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    const res = await fetch(`${url}/api/health`, {
      signal: ctrl.signal,
      cache: 'no-store',
    } as RequestInit);
    clearTimeout(timer);

    if (!res.ok) {
      return { status: 'error', error: `HTTP ${res.status}` };
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
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'offline', error: 'Connection timed out' };
    }
    // Node.js abort error
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'offline', error: 'Connection timed out' };
    }
    return { status: 'offline', error: 'Connection refused' };
  }
}
