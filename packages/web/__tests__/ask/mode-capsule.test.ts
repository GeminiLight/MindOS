import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'mindos-permission-level.v1';
const LEGACY_STORAGE_KEY = 'mindos-ask-mode';

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
    const { getPersistedPermissionLevel, getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionLevel()).toBe('ask');
    expect(getPersistedMode()).toBe('agent');
  });

  it('returns stored permission level values', async () => {
    store[STORAGE_KEY] = 'read';
    const { getPersistedPermissionLevel, getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionLevel()).toBe('read');
    expect(getPersistedMode()).toBe('agent');
  });

  it('migrates legacy chat mode to read permission', async () => {
    store[LEGACY_STORAGE_KEY] = 'chat';
    const { getPersistedPermissionLevel, getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionLevel()).toBe('read');
    expect(getPersistedMode()).toBe('agent');
    expect(store[STORAGE_KEY]).toBe('read');
    expect(store[LEGACY_STORAGE_KEY]).toBeUndefined();
  });

  it('migrates legacy agent mode to ask permission', async () => {
    store[LEGACY_STORAGE_KEY] = 'agent';
    const { getPersistedPermissionLevel, getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionLevel()).toBe('ask');
    expect(getPersistedMode()).toBe('agent');
    expect(store[STORAGE_KEY]).toBe('ask');
  });

  it('falls back to ask permission for invalid stored values', async () => {
    store[STORAGE_KEY] = 'invalid';
    const { getPersistedPermissionLevel } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedPermissionLevel()).toBe('ask');
  });

  it('persists permission level without writing legacy ask mode values', async () => {
    const { persistPermissionLevel, persistMode } = await import('@/components/ask/ModeCapsule');
    persistPermissionLevel('read');
    expect(store[STORAGE_KEY]).toBe('read');
    expect(store[LEGACY_STORAGE_KEY]).toBeUndefined();

    persistPermissionLevel('full');
    expect(store[STORAGE_KEY]).toBe('full');
    expect(store[LEGACY_STORAGE_KEY]).toBeUndefined();

    persistMode('chat');
    expect(store[STORAGE_KEY]).toBe('read');
    expect(store[LEGACY_STORAGE_KEY]).toBeUndefined();
  });
});

describe('Permission level mapping', () => {
  it('maps read permission to agent prompt mode plus readonly runtime behavior', async () => {
    const { permissionLevelToAskMode, permissionLevelToNativeRuntimePermission } = await import('@/components/ask/ModeCapsule');
    expect(permissionLevelToAskMode('read')).toBe('agent');
    expect(permissionLevelToNativeRuntimePermission('read')).toBe('readonly');
  });

  it('maps ask, auto, and full to existing agent runtime behavior', async () => {
    const { permissionLevelToAskMode, permissionLevelToNativeRuntimePermission } = await import('@/components/ask/ModeCapsule');
    for (const level of ['ask', 'auto', 'full'] as const) {
      expect(permissionLevelToAskMode(level)).toBe('agent');
      expect(permissionLevelToNativeRuntimePermission(level)).toBe('agent');
    }
  });
});
