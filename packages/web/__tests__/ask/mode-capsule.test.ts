import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'mindos-permission-level.v1';

/**
 * Module-level persistence for the composer's permission ladder, with storage
 * stubbed so this runs without a DOM. The rendered control is covered by
 * `__tests__/components/permission-ladder.test.tsx`.
 */
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

  async function load() {
    return import('@/components/ask/ModeCapsule');
  }

  it('defaults to ask-first permission when no stored value exists', async () => {
    const { getPersistedPermissionChoice } = await load();
    expect(getPersistedPermissionChoice()).toBe('ask');
  });

  it('returns stored permission levels', async () => {
    store[STORAGE_KEY] = 'auto';
    const { getPersistedPermissionChoice } = await load();
    expect(getPersistedPermissionChoice()).toBe('auto');
  });

  it('restores read-only, which is now a selectable rung rather than an internal state', async () => {
    store[STORAGE_KEY] = 'read';
    const { getPersistedPermissionChoice } = await load();
    expect(getPersistedPermissionChoice()).toBe('read');
  });

  it('restores plan, so the ladder survives a reload', async () => {
    store[STORAGE_KEY] = 'plan';
    const { getPersistedPermissionChoice } = await load();
    expect(getPersistedPermissionChoice()).toBe('plan');
  });

  it('falls back to ask permission for invalid stored values', async () => {
    store[STORAGE_KEY] = 'invalid';
    const { getPersistedPermissionChoice } = await load();
    expect(getPersistedPermissionChoice()).toBe('ask');
  });

  it('writes the chosen level back, including plan', async () => {
    const { persistPermissionChoice, getPersistedPermissionChoice } = await load();
    persistPermissionChoice('plan');
    expect(store[STORAGE_KEY]).toBe('plan');
    expect(getPersistedPermissionChoice()).toBe('plan');
  });
});
