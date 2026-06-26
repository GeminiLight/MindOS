'use client';

import { useSyncExternalStore } from 'react';

export const OPTIONAL_RAIL_ITEMS = ['studio', 'flow'] as const;

export type OptionalRailItem = (typeof OPTIONAL_RAIL_ITEMS)[number];

export interface RailPreferences {
  studio: boolean;
  flow: boolean;
}

export const RAIL_PREFERENCES_CHANGED_EVENT = 'mindos:rail-preferences-changed';
export const LEGACY_LABS_CHANGED_EVENT = 'mindos:labs-changed';

export const RAIL_STORAGE_KEYS: Record<OptionalRailItem, string> = {
  studio: 'mindos:rail-studio',
  flow: 'mindos:labs-workflows',
};

export const DEFAULT_RAIL_PREFERENCES: RailPreferences = {
  studio: true,
  flow: false,
};

let cachedSnapshot: RailPreferences = DEFAULT_RAIL_PREFERENCES;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readFlag(key: string, defaultValue: boolean): boolean {
  if (!canUseStorage()) return defaultValue;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === '1';
  } catch {
    return defaultValue;
  }
}

export function readRailPreferences(): RailPreferences {
  const next = {
    studio: readFlag(RAIL_STORAGE_KEYS.studio, DEFAULT_RAIL_PREFERENCES.studio),
    flow: readFlag(RAIL_STORAGE_KEYS.flow, DEFAULT_RAIL_PREFERENCES.flow),
  };

  if (
    next.studio === cachedSnapshot.studio &&
    next.flow === cachedSnapshot.flow
  ) {
    return cachedSnapshot;
  }

  cachedSnapshot = next;
  return cachedSnapshot;
}

export function writeRailPreference(item: OptionalRailItem, enabled: boolean): void {
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEYS[item], enabled ? '1' : '0');
    } catch {
      // A blocked storage write should not break Settings or rail rendering.
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(RAIL_PREFERENCES_CHANGED_EVENT));
    if (item === 'flow') {
      window.dispatchEvent(new Event(LEGACY_LABS_CHANGED_EVENT));
    }
  }
}

export function subscribeRailPreferences(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key && !Object.values(RAIL_STORAGE_KEYS).includes(event.key)) return;
    callback();
  };

  window.addEventListener(RAIL_PREFERENCES_CHANGED_EVENT, callback);
  window.addEventListener(LEGACY_LABS_CHANGED_EVENT, callback);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(RAIL_PREFERENCES_CHANGED_EVENT, callback);
    window.removeEventListener(LEGACY_LABS_CHANGED_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function useRailPreferences(): RailPreferences {
  return useSyncExternalStore(
    subscribeRailPreferences,
    readRailPreferences,
    () => DEFAULT_RAIL_PREFERENCES,
  );
}
