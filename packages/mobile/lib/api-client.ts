/**
 * MindOS API client for mobile.
 * Communicates with the MindOS web server over HTTP.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  FileNode,
  SearchResult,
  HealthResponse,
  ConnectResponse,
  FileSaveResponse,
  FileDeleteResponse,
  FileRenameResponse,
} from './types';

const STORAGE_KEY = 'mindos_server_url';
const TREE_CACHE_KEY = 'mindos_file_tree_cache';
const DEFAULT_TIMEOUT = 15_000;

class MindOSClient {
  private _baseUrl = '';

  get baseUrl() {
    return this._baseUrl;
  }

  get isConnected() {
    return this._baseUrl.length > 0;
  }

  /** Load saved server URL from storage. Call once on app start. */
  async init(): Promise<boolean> {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) {
      this._baseUrl = saved;
      return true;
    }
    return false;
  }

  /** Set base URL in memory (does NOT persist). */
  setBaseUrl(url: string): void {
    this._baseUrl = url.replace(/\/+$/, '');
  }

  /** Persist current base URL to storage. Call only after verifying connection. */
  async persistServer(): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, this._baseUrl);
  }

  /** Clear the saved server URL. */
  async disconnect(): Promise<void> {
    this._baseUrl = '';
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  // ---------------------------------------------------------------------------
  // Health & discovery
  // ---------------------------------------------------------------------------

  async health(): Promise<HealthResponse | null> {
    try {
      const res = await this.fetchWithTimeout('/api/health', { timeout: 5000 });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async getConnectInfo(): Promise<ConnectResponse | null> {
    try {
      const res = await this.fetchWithTimeout('/api/connect');
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  async getFileTree(): Promise<FileNode[]> {
    try {
      const res = await this.fetchWithTimeout('/api/files');
      if (!res.ok) throw new ApiError(res.status, 'Failed to load files');
      const data = await res.json();
      const tree = data.tree ?? data;
      if (!Array.isArray(tree)) throw new ApiError(500, 'Invalid response format');
      // Cache for offline use
      AsyncStorage.setItem(TREE_CACHE_KEY, JSON.stringify(tree)).catch(() => {});
      return tree;
    } catch (e) {
      // Fallback to cached tree when offline
      const cached = await AsyncStorage.getItem(TREE_CACHE_KEY).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        } catch { /* corrupt cache */ }
      }
      throw e;
    }
  }

  /** Check if a file exists (returns true/false, never throws). */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(
        `/api/file?path=${enc(filePath)}&op=read_file`,
        { timeout: 5000 },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async getFileContent(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; mtime?: number }> {
    const res = await this.fetchWithTimeout(
      `/api/file?path=${enc(filePath)}&op=read_file`,
      { signal },
    );
    if (!res.ok) throw new ApiError(res.status, `Failed to read ${filePath}`);
    return res.json();
  }

  async saveFile(
    filePath: string,
    content: string,
    expectedMtime?: number,
  ): Promise<FileSaveResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({
        op: 'save_file',
        path: filePath,
        content,
        expectedMtime,
      }),
    });
    const data = await res.json();
    if (res.status === 409) return { ok: false, error: 'conflict', serverMtime: data.serverMtime };
    if (!res.ok) throw new ApiError(res.status, data.error || 'Save failed');
    return { ok: true, mtime: data.mtime };
  }

  async deleteFile(filePath: string): Promise<FileDeleteResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({ op: 'delete_file', path: filePath }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Delete failed' }));
      throw new ApiError(res.status, data.error || 'Delete failed');
    }
    return res.json();
  }

  async renameFile(filePath: string, newName: string): Promise<FileRenameResponse> {
    const res = await this.fetchWithTimeout('/api/file', {
      method: 'POST',
      body: JSON.stringify({ op: 'rename_file', path: filePath, new_name: newName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Rename failed' }));
      throw new ApiError(res.status, data.error || 'Rename failed');
    }
    return res.json();
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  async search(query: string): Promise<SearchResult[]> {
    const res = await this.fetchWithTimeout(`/api/search?q=${enc(query)}`);
    if (!res.ok) throw new ApiError(res.status, 'Search failed');
    const data = await res.json();
    const results = data.results ?? data;
    if (!Array.isArray(results)) return [];
    return results;
  }

  // ---------------------------------------------------------------------------
  // Internal fetch wrapper — uses AbortController (RN-compatible, no AbortSignal.timeout)
  // ---------------------------------------------------------------------------

  private fetchWithTimeout(
    path: string,
    opts: { method?: string; body?: string; timeout?: number; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const { method = 'GET', body, timeout = DEFAULT_TIMEOUT, signal } = opts;
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // If an external signal is provided, forward its abort
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    return fetch(`${this._baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  }
}

function enc(s: string) {
  return encodeURIComponent(s);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Singleton API client */
export const mindosClient = new MindOSClient();
