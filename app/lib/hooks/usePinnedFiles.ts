'use client';

import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'mindos-pinned-files';
const EVENT_KEY = 'mindos:pins-changed';

function getSnapshot(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getServerSnapshot(): string[] {
  return [];
}

let cachedPins: string[] = getSnapshot();

function subscribe(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cachedPins = getSnapshot();
      callback();
    }
  };
  const onCustom = () => {
    cachedPins = getSnapshot();
    callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT_KEY, onCustom);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT_KEY, onCustom);
  };
}

function writePins(pins: string[]): void {
  cachedPins = pins;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  window.dispatchEvent(new Event(EVENT_KEY));
}

export function usePinnedFiles() {
  const pins = useSyncExternalStore(subscribe, () => cachedPins, getServerSnapshot);

  const isPinned = useCallback((path: string) => pins.includes(path), [pins]);

  const togglePin = useCallback((path: string) => {
    const current = getSnapshot();
    const idx = current.indexOf(path);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.unshift(path); // newest pin at top
    }
    writePins(current);
  }, []);

  const reorderPins = useCallback((newOrder: string[]) => {
    writePins(newOrder);
  }, []);

  const removePin = useCallback((path: string) => {
    const current = getSnapshot();
    writePins(current.filter(p => p !== path));
  }, []);

  return { pinnedFiles: pins, isPinned, togglePin, reorderPins, removePin };
}
