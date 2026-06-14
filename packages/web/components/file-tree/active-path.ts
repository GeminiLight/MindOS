'use client';

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

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
  subscribeFile: (path: string, listener: () => void) => () => void;
  subscribeActivePath: (path: string, listener: () => void) => () => void;
  get: () => string;
  set: (path: string) => void;
}

function subscribeKeyed(
  listenersByPath: Map<string, Set<() => void>>,
  path: string,
  listener: () => void,
): () => void {
  let listeners = listenersByPath.get(path);
  if (!listeners) {
    listeners = new Set();
    listenersByPath.set(path, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) listenersByPath.delete(path);
  };
}

function notifyKeyed(listenersByPath: Map<string, Set<() => void>>, path: string): void {
  const listeners = listenersByPath.get(path);
  if (!listeners) return;
  for (const listener of [...listeners]) listener();
}

function activePathKeys(path: string): Set<string> {
  const keys = new Set<string>();
  const segments = path.split('/').filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    keys.add(segments.slice(0, index + 1).join('/'));
  }
  return keys;
}

function changedActivePathKeys(previous: string, next: string): Set<string> {
  const previousKeys = activePathKeys(previous);
  const nextKeys = activePathKeys(next);
  const changed = new Set<string>();
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) changed.add(key);
  }
  for (const key of nextKeys) {
    if (!previousKeys.has(key)) changed.add(key);
  }
  return changed;
}

export function createActivePathStore(initial = ''): ActivePathStore {
  let current = initial;
  const listeners = new Set<() => void>();
  const fileListeners = new Map<string, Set<() => void>>();
  const activePathListeners = new Map<string, Set<() => void>>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeFile(path, listener) {
      return subscribeKeyed(fileListeners, path, listener);
    },
    subscribeActivePath(path, listener) {
      return subscribeKeyed(activePathListeners, path, listener);
    },
    get: () => current,
    set(path) {
      if (path === current) return;
      const previous = current;
      current = path;
      notifyKeyed(fileListeners, previous);
      notifyKeyed(fileListeners, path);
      for (const key of changedActivePathKeys(previous, path)) {
        notifyKeyed(activePathListeners, key);
      }
      // Copy before iterating: a listener may unsubscribe mid-notify.
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
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeFile(path, listener),
    [path, store],
  );
  return useSyncExternalStore(
    subscribe,
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
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeActivePath(path, listener),
    [path, store],
  );
  return useSyncExternalStore(subscribe, matches, matches);
}
