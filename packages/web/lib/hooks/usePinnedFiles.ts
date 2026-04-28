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

function getClientSnapshot(): string[] {
  return cachedPins;
}

const SERVER_SNAPSHOT: string[] = [];
function getServerSnapshot(): string[] {
  return SERVER_SNAPSHOT;
}

// Lazy init — avoid calling getSnapshot() at module load time during SSR
let cachedPins: string[] = [];
let initialized = false;

function ensureInit(): void {
  if (!initialized && typeof window !== 'undefined') {
    cachedPins = getSnapshot();
    initialized = true;
  }
}

function subscribe(callback: () => void): () => void {
  ensureInit();
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // localStorage unavailable (private browsing, quota exceeded) — memory only
  }
  window.dispatchEvent(new Event(EVENT_KEY));
}

export function usePinnedFiles() {
  ensureInit();
  const pins = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

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
