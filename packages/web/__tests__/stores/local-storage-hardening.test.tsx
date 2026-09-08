// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function blockStorage() {
  const throwSecurity = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  vi.spyOn(localStorage, 'getItem').mockImplementation(throwSecurity);
  vi.spyOn(localStorage, 'setItem').mockImplementation(throwSecurity);
}

describe('localStorage hardening (Safari "block all cookies")', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hidden-files store falls back to hidden and still broadcasts changes', async () => {
    blockStorage();
    const { useShowHiddenFiles, setShowHiddenFiles } = await import('@/lib/stores/hidden-files');

    let seen: boolean | null = null;
    function Probe() {
      seen = useShowHiddenFiles();
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => { root.render(<Probe />); });
    expect(seen).toBe(false);

    const listener = vi.fn();
    window.addEventListener('mindos:hidden-files-changed', listener);
    expect(() => act(() => { setShowHiddenFiles(true); })).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('mindos:hidden-files-changed', listener);
    act(() => { root.unmount(); });
  });

  it('editor theme store initializes to system and still updates in memory', async () => {
    blockStorage();
    const { useEditorTheme } = await import('@/lib/stores/editor-theme-store');
    expect(useEditorTheme.getState().theme).toBe('system');
    expect(() => useEditorTheme.getState().setTheme('nord')).not.toThrow();
    expect(useEditorTheme.getState().theme).toBe('nord');
  });

  it('locale store resolves the locale without throwing', async () => {
    blockStorage();
    const { useLocaleStore } = await import('@/lib/stores/locale-store');
    let cleanup: (() => void) | undefined;
    expect(() => { cleanup = useLocaleStore.getState()._init('en'); }).not.toThrow();
    expect(['en', 'zh']).toContain(useLocaleStore.getState().locale);
    cleanup?.();
  });
});
