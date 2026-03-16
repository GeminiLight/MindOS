'use client';

import { useSyncExternalStore, useCallback, useRef } from 'react';

/**
 * Unified per-file state hook for renderers.
 *
 * Each renderer stores its state under a namespaced localStorage key:
 *   `mindos-renderer:{rendererId}:{filePath}`
 *
 * Usage:
 *   const [cfg, setCfg] = useRendererState<CsvConfig>('csv', filePath, defaultCfg);
 *
 * The state is reactive — changes from other tabs/windows or from other
 * components calling the setter will trigger a re-render via
 * `useSyncExternalStore`.
 */

const CHANGE_EVENT = 'mindos-renderer-state-change';

function storageKey(rendererId: string, filePath: string): string {
  return `mindos-renderer:${rendererId}:${filePath}`;
}

export function useRendererState<T>(
  rendererId: string,
  filePath: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const key = storageKey(rendererId, filePath);

  // Cache parsed value to maintain referential stability for useSyncExternalStore.
  // Without this, JSON.parse returns a new object on every getSnapshot call,
  // causing Object.is to fail → infinite re-renders for non-primitive types.
  const cacheRef = useRef<{ raw: string | null; parsed: T }>({ raw: null, parsed: defaultValue });

  const state = useSyncExternalStore(
    (onStoreChange) => {
      const listener = () => onStoreChange();
      window.addEventListener('storage', listener);
      window.addEventListener(CHANGE_EVENT, listener);
      return () => {
        window.removeEventListener('storage', listener);
        window.removeEventListener(CHANGE_EVENT, listener);
      };
    },
    () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw === cacheRef.current.raw) return cacheRef.current.parsed;
        if (raw === null) {
          cacheRef.current = { raw: null, parsed: defaultValue };
          return defaultValue;
        }
        const parsed = JSON.parse(raw) as T;
        cacheRef.current = { raw, parsed };
        return parsed;
      } catch {
        return defaultValue;
      }
    },
    () => defaultValue,
  );

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const current = (() => {
          try {
            const raw = localStorage.getItem(key);
            return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
          } catch {
            return defaultValue;
          }
        })();
        const next = typeof value === 'function' ? (value as (prev: T) => T)(current) : value;
        const serialized = JSON.stringify(next);
        localStorage.setItem(key, serialized);
        // Update cache eagerly so the next getSnapshot returns stable ref
        cacheRef.current = { raw: serialized, parsed: next };
      } catch { /* ignore quota errors */ }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key, defaultValue],
  );

  return [state, setState];
}

/**
 * Non-hook helpers for reading/writing renderer state outside React components.
 */
export function getRendererState<T>(rendererId: string, filePath: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = localStorage.getItem(storageKey(rendererId, filePath));
    return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setRendererState<T>(rendererId: string, filePath: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(rendererId, filePath), JSON.stringify(value));
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
