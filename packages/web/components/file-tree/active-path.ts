'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * Tiny external store for the currently active file path.
 *
 * Why not pass `currentPath` down as a prop: the file tree renders one row per
 * file (500+ in large vaults). A `currentPath` prop changes on every
 * navigation, which invalidates `React.memo` on every row and re-renders the
 * whole tree. With this store, rows subscribe to a *boolean* snapshot
 * ("am I active / on the active path?") via `useSyncExternalStore`, so a
 * navigation only re-renders the rows whose boolean actually flipped —
 * the previously active row and the newly active one.
 */
export interface ActivePathStore {
  subscribe: (listener: () => void) => () => void;
  get: () => string;
  set: (path: string) => void;
}

export function createActivePathStore(initial = ''): ActivePathStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get: () => current,
    set(path) {
      if (path === current) return;
      current = path;
      // Copy before iterating: a listener may unsubscribe (row unmount) mid-notify.
      for (const listener of [...listeners]) listener();
    },
  };
}

// Fallback store so rows rendered outside a provider (tests, storybook-style
// harnesses) behave as "nothing active" instead of crashing.
const fallbackStore = createActivePathStore('');

export const ActivePathContext = createContext<ActivePathStore>(fallbackStore);

/** True when `path` is exactly the active file. Re-renders only when this flips. */
export function useIsActiveFile(path: string): boolean {
  const store = useContext(ActivePathContext);
  return useSyncExternalStore(
    store.subscribe,
    () => store.get() === path,
    () => store.get() === path,
  );
}

/**
 * True when the active file is `path` itself or inside the directory `path`.
 * Re-renders only when this flips.
 */
export function useIsOnActivePath(path: string): boolean {
  const store = useContext(ActivePathContext);
  const matches = () => {
    const current = store.get();
    return current === path || current.startsWith(path + '/');
  };
  return useSyncExternalStore(store.subscribe, matches, matches);
}
