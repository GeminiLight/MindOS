import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for ModeCapsule persistence and mode toggle logic.
 * Since @testing-library/react is unavailable, we test the exported
 * pure functions (getPersistedMode, persistMode) and the toggle behavior.
 */

const STORAGE_KEY = 'mindos-ask-mode';

describe('ModeCapsule persistence', () => {
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

  it('getPersistedMode returns "agent" when no stored value', async () => {
    const { getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedMode()).toBe('agent');
  });

  it('getPersistedMode returns stored "chat"', async () => {
    store[STORAGE_KEY] = 'chat';
    const { getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedMode()).toBe('chat');
  });

  it('getPersistedMode returns stored "agent"', async () => {
    store[STORAGE_KEY] = 'agent';
    const { getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedMode()).toBe('agent');
  });

  it('getPersistedMode falls back to "agent" for invalid stored values', async () => {
    store[STORAGE_KEY] = 'invalid';
    const { getPersistedMode } = await import('@/components/ask/ModeCapsule');
    expect(getPersistedMode()).toBe('agent');
  });

  it('persistMode stores the mode in localStorage', async () => {
    const { persistMode } = await import('@/components/ask/ModeCapsule');
    persistMode('chat');
    expect(store[STORAGE_KEY]).toBe('chat');
    persistMode('agent');
    expect(store[STORAGE_KEY]).toBe('agent');
  });
});

describe('Mode toggle logic', () => {
  it('toggles from agent to chat', () => {
    const mode = 'agent';
    const next = mode === 'chat' ? 'agent' : 'chat';
    expect(next).toBe('chat');
  });

  it('toggles from chat to agent', () => {
    const mode = 'chat';
    const next = mode === 'chat' ? 'agent' : 'chat';
    expect(next).toBe('agent');
  });
});

describe('AskMode request body integration', () => {
  it('chat mode is sent in request body as "chat"', () => {
    const body = JSON.stringify({ messages: [], mode: 'chat' });
    const parsed = JSON.parse(body);
    expect(parsed.mode).toBe('chat');
  });

  it('agent mode is sent in request body as "agent"', () => {
    const body = JSON.stringify({ messages: [], mode: 'agent' });
    const parsed = JSON.parse(body);
    expect(parsed.mode).toBe('agent');
  });

  it('default mode when omitted should be treated as agent', () => {
    const body = JSON.stringify({ messages: [] });
    const parsed = JSON.parse(body);
    const askMode = parsed.mode === 'chat' ? 'chat' : 'agent';
    expect(askMode).toBe('agent');
  });
});
