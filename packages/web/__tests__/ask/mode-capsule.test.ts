import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'mindos-permission-level.v1';

describe('Permission capsule persistence', () => {
  let store: Record<string, string>;
  const fakeStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
  };

  beforeEach(() => {
    store = {};
    vi.resetModules();
    vi.stubGlobal('window', { localStorage: fakeStorage });
    vi.stubGlobal('localStorage', fakeStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to ask-first permission when no stored value exists', async () => {
    const { getPersistedPermissionMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionMode()).toBe('ask');
  });

  it('returns stored permission mode values', async () => {
    store[STORAGE_KEY] = 'auto';
    const { getPersistedPermissionMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionMode()).toBe('auto');
  });

  it('does not restore the legacy read-only composer permission', async () => {
    store[STORAGE_KEY] = 'read';
    const { getPersistedPermissionMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionMode()).toBe('ask');
  });

  it('falls back to ask permission for invalid stored values', async () => {
    store[STORAGE_KEY] = 'invalid';
    const { getPersistedPermissionMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionMode()).toBe('ask');
  });

  it('persists permission mode without writing legacy ask-mode storage', async () => {
    const { persistPermissionMode } = await import('@/components/ask/ModeCapsule');
    persistPermissionMode('read');
    expect(store[STORAGE_KEY]).toBe('ask');

    persistPermissionMode('full');
    expect(store[STORAGE_KEY]).toBe('full');
  });
});
