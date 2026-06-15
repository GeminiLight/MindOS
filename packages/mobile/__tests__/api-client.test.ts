import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
const secureStorage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
    multiGet: vi.fn((keys: string[]) => Promise.resolve(keys.map((key) => [key, storage.get(key) ?? null]))),
    multiRemove: vi.fn((keys: string[]) => {
      keys.forEach((key) => storage.delete(key));
      return Promise.resolve();
    }),
  },
}));

import { mindosClient } from '@/lib/api-client';
import {
  LEGACY_AUTH_TOKEN_STORAGE_KEY,
  readConnectionAuthToken,
  setSecureTokenStoreAdapterForTests,
} from '@/lib/connection-secret-store';

describe('mindosClient auth', () => {
  beforeEach(async () => {
    storage.clear();
    secureStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    setSecureTokenStoreAdapterForTests({
      getItemAsync: vi.fn((key: string) => Promise.resolve(secureStorage.get(key) ?? null)),
      setItemAsync: vi.fn((key: string, value: string) => {
        secureStorage.set(key, value);
        return Promise.resolve();
      }),
      deleteItemAsync: vi.fn((key: string) => {
        secureStorage.delete(key);
        return Promise.resolve();
      }),
    });
    await mindosClient.disconnect();
    mindosClient.setConnectionObserver(null);
  });

  it('sends the bearer token on API requests', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567/');
    mindosClient.setAuthToken('  secret-token  ');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tree: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await mindosClient.getFileTree();

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/files',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
  });

  it('normalizes the server file path list into a mobile file tree', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(['Space/note.md']), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.getFileTree()).resolves.toEqual([
      {
        type: 'directory',
        name: 'Space',
        path: 'Space',
        children: [
          { type: 'file', name: 'note.md', path: 'Space/note.md', extension: '.md' },
        ],
      },
    ]);
  });

  it('returns stale cached file tree data when refresh fails', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    storage.set('mindos_file_tree_cache', JSON.stringify([
      { type: 'file', name: 'cached.md', path: 'cached.md', extension: '.md' },
    ]));

    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network request failed'));

    await expect(mindosClient.getFileTreeWithStatus()).resolves.toEqual({
      stale: true,
      error: 'Network request failed',
      tree: [
        { type: 'file', name: 'cached.md', path: 'cached.md', extension: '.md' },
      ],
    });
  });

  it('creates files through the no-overwrite create_file operation', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, mtime: 123 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.createFile('Space/note.md', '# Note\n')).resolves.toEqual({
      ok: true,
      mtime: 123,
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/file',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          op: 'create_file',
          path: 'Space/note.md',
          content: '# Note\n',
        }),
      }),
    );
  });

  it('maps create_file conflicts to a non-overwriting exists result', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'File already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.createFile('note.md', '# Note\n')).resolves.toEqual({
      ok: false,
      error: 'exists',
    });
  });

  it('persists and clears the optional access token through secure storage', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    await mindosClient.persistServer();

    expect(storage.get('mindos_server_url')).toBe('http://127.0.0.1:4567');
    expect(storage.has(LEGACY_AUTH_TOKEN_STORAGE_KEY)).toBe(false);
    await expect(readConnectionAuthToken()).resolves.toBe('secret-token');

    await mindosClient.disconnect();

    expect(mindosClient.baseUrl).toBe('');
    expect(mindosClient.hasAuthToken).toBe(false);
    expect(storage.has('mindos_server_url')).toBe(false);
    expect(storage.has(LEGACY_AUTH_TOKEN_STORAGE_KEY)).toBe(false);
    await expect(readConnectionAuthToken()).resolves.toBe('');
  });

  it('maps protected API failures to auth_required during probing', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');

    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(mindosClient.probeApiAccess()).resolves.toEqual({
      ok: false,
      reason: 'auth_required',
      status: 401,
      message: 'Access token required or invalid.',
    });
  });

  it('loads agent runtimes with auth and normalizes malformed registry payloads', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ runtimes: 'bad', installed: null, notInstalled: undefined }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.getAgentRuntimes({ force: true })).resolves.toEqual({
      runtimes: [],
      installed: [],
      notInstalled: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/agent-runtimes?force=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
  });

  it('resolves runtime permission requests through the MindOS server', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.resolveRuntimePermission({
      runId: 'run-1',
      requestId: 'req-1',
      decision: 'allow-once',
    })).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/ask/runtime-permission',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        }),
        body: JSON.stringify({
          runId: 'run-1',
          requestId: 'req-1',
          decision: 'allow-once',
        }),
      }),
    );
  });

  it('notifies connection observers for API success and connection failures only', async () => {
    const events: unknown[] = [];
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setConnectionObserver((event) => events.push(event));

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'File already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('Server error', { status: 500 }));

    await mindosClient.getFileTree();
    await expect(mindosClient.createFile('note.md', '# Note\n')).resolves.toEqual({
      ok: false,
      error: 'exists',
    });
    await expect(mindosClient.search('hello')).rejects.toMatchObject({ status: 500 });

    expect(events).toMatchObject([
      { type: 'success', path: '/api/files' },
      { type: 'failure', path: '/api/search?q=hello', reason: 'api_unavailable', status: 500 },
    ]);
  });
});
