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
  },
}));

import {
  LEGACY_AUTH_TOKEN_STORAGE_KEY,
  clearConnectionAuthToken,
  persistConnectionAuthToken,
  readConnectionAuthToken,
  setSecureTokenStoreAdapterForTests,
} from '@/lib/connection-secret-store';

describe('connection secret store', () => {
  beforeEach(() => {
    storage.clear();
    secureStorage.clear();
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
  });

  it('migrates legacy AsyncStorage tokens into secure storage', async () => {
    storage.set(LEGACY_AUTH_TOKEN_STORAGE_KEY, ' legacy-token ');

    await expect(readConnectionAuthToken()).resolves.toBe('legacy-token');
    expect(storage.has(LEGACY_AUTH_TOKEN_STORAGE_KEY)).toBe(false);
    await expect(readConnectionAuthToken()).resolves.toBe('legacy-token');
  });

  it('persists and clears secure tokens without leaving legacy copies', async () => {
    storage.set(LEGACY_AUTH_TOKEN_STORAGE_KEY, 'old-token');

    await persistConnectionAuthToken(' new-token ');

    expect(storage.has(LEGACY_AUTH_TOKEN_STORAGE_KEY)).toBe(false);
    await expect(readConnectionAuthToken()).resolves.toBe('new-token');

    await clearConnectionAuthToken();

    await expect(readConnectionAuthToken()).resolves.toBe('');
  });

  it('surfaces secure storage failures instead of silently using AsyncStorage', async () => {
    setSecureTokenStoreAdapterForTests({
      getItemAsync: vi.fn(() => Promise.resolve(null)),
      setItemAsync: vi.fn(() => Promise.reject(new Error('secure store failed'))),
      deleteItemAsync: vi.fn(() => Promise.resolve()),
    });

    await expect(persistConnectionAuthToken('secret')).rejects.toThrow('secure store failed');
    expect(storage.has(LEGACY_AUTH_TOKEN_STORAGE_KEY)).toBe(false);
  });
});
