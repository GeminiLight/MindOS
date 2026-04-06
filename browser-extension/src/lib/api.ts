/* ── MindOS API Client ── */

import type { ClipperConfig, MindOSSpace, FileApiResponse } from './types';

const REQUEST_TIMEOUT = 8000;

/** Fetch with timeout + auth */
async function apiFetch(
  config: ClipperConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const url = `${config.mindosUrl.replace(/\/+$/, '')}${path}`;
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.authToken}`,
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Check if MindOS is running and token is valid */
export async function testConnection(config: ClipperConfig): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    // Health check (no auth required)
    const healthRes = await apiFetch(config, '/api/health');
    if (!healthRes.ok) {
      return { ok: false, error: `Server returned ${healthRes.status}` };
    }

    // Auth check — try listing spaces
    const spacesRes = await apiFetch(config, '/api/file?op=list_spaces');
    if (spacesRes.status === 401 || spacesRes.status === 403) {
      return { ok: false, error: 'Invalid auth token' };
    }
    if (!spacesRes.ok) {
      return { ok: false, error: `Auth check failed (${spacesRes.status})` };
    }

    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out' };
    }
    return { ok: false, error: 'Cannot reach MindOS — is it running?' };
  }
}

/** List available spaces (top-level directories) */
export async function listSpaces(config: ClipperConfig): Promise<MindOSSpace[]> {
  try {
    const res = await apiFetch(config, '/api/file?op=list_spaces');
    if (!res.ok) return [];
    const data = await res.json();
    return (data.spaces ?? []) as MindOSSpace[];
  } catch {
    return [];
  }
}

/** List all directory paths (flat list for hierarchical picker) */
export async function listDirs(config: ClipperConfig): Promise<string[]> {
  try {
    const res = await apiFetch(config, '/api/file?op=list_dirs');
    if (!res.ok) return [];
    const data = await res.json();
    return (data.dirs ?? []) as string[];
  } catch {
    return [];
  }
}

/** Save markdown to Inbox */
export async function saveToInbox(
  config: ClipperConfig,
  fileName: string,
  markdown: string,
): Promise<FileApiResponse> {
  try {
    const res = await apiFetch(config, '/api/inbox', {
      method: 'POST',
      body: JSON.stringify({
        files: [{ name: fileName, content: markdown, encoding: 'text' }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error ?? `Server error (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { error: 'Request timed out' };
    }
    return { error: 'Cannot reach MindOS — is it running?' };
  }
}

/** Create file in a specific space */
export async function createFile(
  config: ClipperConfig,
  space: string,
  fileName: string,
  content: string,
): Promise<FileApiResponse> {
  const path = space ? `${space}/${fileName}` : fileName;
  try {
    const res = await apiFetch(config, '/api/file', {
      method: 'POST',
      body: JSON.stringify({ op: 'create_file', path, content, source: 'user' }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error ?? `Server error (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { error: 'Request timed out' };
    }
    return { error: 'Cannot reach MindOS — is it running?' };
  }
}
