/**
 * Remote-mode HTTP helpers for MindOS CLI.
 *
 * When MINDOS_URL is set to a non-localhost address, CLI commands should
 * use these helpers to make HTTP API calls instead of direct fs operations.
 */

/**
 * Check if CLI is operating in remote mode.
 * Remote = MINDOS_URL is set and not pointing to localhost/127.0.0.1.
 */
export function isRemoteMode() {
  const url = process.env.MINDOS_URL;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0';
  } catch {
    return false;
  }
}

/**
 * Get the base URL for API calls.
 * In remote mode: MINDOS_URL
 * In local mode: http://localhost:<MINDOS_WEB_PORT || 3456>
 */
export function getBaseUrl() {
  if (process.env.MINDOS_URL) return process.env.MINDOS_URL.replace(/\/$/, '');
  const port = process.env.MINDOS_WEB_PORT || '3456';
  return `http://localhost:${port}`;
}

/**
 * Build headers with auth token if available.
 */
export function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = process.env.AUTH_TOKEN || process.env.MINDOS_AUTH_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Make an authenticated API call to the MindOS backend.
 * @param {string} path - API path (e.g. '/api/file')
 * @param {object} [options] - fetch options (method, body, etc.)
 * @returns {Promise<Response>}
 */
export async function apiCall(path, options = {}) {
  const url = `${getBaseUrl()}${path}`;
  const headers = { ...getAuthHeaders(), ...options.headers };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint = res.status === 401
      ? ' (check AUTH_TOKEN — run `mindos token` on the server)'
      : res.status === 404
      ? ' (is MindOS running? try `mindos start`)'
      : '';
    throw new Error(`API ${res.status}: ${text || res.statusText}${hint}`);
  }
  return res;
}
