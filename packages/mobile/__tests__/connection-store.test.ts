import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
const secureStorage = vi.hoisted(() => new Map<string, string>());

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' },
}));

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
  },
}));

import { mindosClient } from '@/lib/api-client';
import { useConnectionStore } from '@/lib/connection-store';
import { setSecureTokenStoreAdapterForTests } from '@/lib/connection-secret-store';

describe('connection store', () => {
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
    await useConnectionStore.getState().disconnect();
    useConnectionStore.setState({
      status: 'disconnected',
      activeOperation: null,
      serverUrl: '',
      serverVersion: '',
      hostname: '',
      hasAuthToken: false,
      error: '',
      diagnostic: undefined,
      lastCheckedAt: undefined,
    });
  });

  it('moves global state offline on request failure and restores it on success', () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    useConnectionStore.setState({
      status: 'connected',
      serverUrl: 'http://127.0.0.1:4567',
      hasAuthToken: false,
    });

    useConnectionStore.getState().markRequestFailure('connection_lost', 'Network request failed.', 1000);

    expect(useConnectionStore.getState()).toMatchObject({
      status: 'error',
      diagnostic: { reason: 'connection_lost', message: 'Network request failed.', checkedAt: 1000 },
      lastCheckedAt: 1000,
    });

    useConnectionStore.getState().markRequestSuccess(2000);

    expect(useConnectionStore.getState()).toMatchObject({
      status: 'connected',
      error: '',
      diagnostic: undefined,
      lastCheckedAt: 2000,
    });
  });

  it('does not let an in-flight health check reconnect after disconnect', async () => {
    const health = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(health.promise);
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    useConnectionStore.setState({
      status: 'connected',
      serverUrl: 'http://127.0.0.1:4567',
      hasAuthToken: false,
    });

    const check = useConnectionStore.getState().checkHealth();
    await Promise.resolve();
    await useConnectionStore.getState().disconnect();

    health.resolve(jsonResponse({ ok: true, service: 'mindos', version: '1.0.0', authRequired: false }));
    await expect(check).resolves.toBe(false);

    expect(useConnectionStore.getState()).toMatchObject({
      status: 'disconnected',
      serverUrl: '',
    });
  });

  it('discards an older connect attempt when the user switches server', async () => {
    const firstHealth = deferred<Response>();
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'http://a.local:4567/api/health') return firstHealth.promise;
      if (url === 'http://b.local:4567/api/health') {
        return Promise.resolve(jsonResponse({ ok: true, service: 'mindos', version: '2.0.0', authRequired: false }));
      }
      if (url === 'http://b.local:4567/api/files?limit=1') {
        return Promise.resolve(jsonResponse({ files: [] }));
      }
      if (url === 'http://b.local:4567/api/connect') {
        return Promise.resolve(jsonResponse({
          url: 'http://b.local:4567',
          ip: '127.0.0.1',
          port: 4567,
          hostname: 'new-host',
        }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const first = useConnectionStore.getState().connect('http://a.local:4567');
    await Promise.resolve();
    const second = useConnectionStore.getState().connect('http://b.local:4567');

    await expect(second).resolves.toBe(true);
    firstHealth.resolve(jsonResponse({ ok: true, service: 'mindos', version: '1.0.0', authRequired: false }));
    await expect(first).resolves.toBe(false);

    expect(useConnectionStore.getState()).toMatchObject({
      status: 'connected',
      serverUrl: 'http://b.local:4567',
      serverVersion: '2.0.0',
      hostname: 'new-host',
    });
  });

  it('classifies protected API failures as auth diagnostics during connect', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true, service: 'mindos', version: '1.0.0', authRequired: true }))
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(useConnectionStore.getState().connect('http://127.0.0.1:4567')).resolves.toBe(false);

    expect(useConnectionStore.getState()).toMatchObject({
      status: 'error',
      diagnostic: { reason: 'auth_required' },
      serverUrl: '',
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
