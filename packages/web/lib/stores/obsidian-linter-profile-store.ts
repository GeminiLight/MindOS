'use client';

import { useSyncExternalStore } from 'react';
import {
  normalizeObsidianLinterRuleProfile,
  OBSIDIAN_LINTER_RULE_METADATA,
  type ObsidianLinterAdapterRuleId,
  type ObsidianLinterRuleProfile,
  type ObsidianLinterRuleProfileInput,
} from '@/lib/obsidian-compat/linter-adapter';

export const OBSIDIAN_LINTER_PROFILE_STORAGE_KEY = 'mindos:obsidian-linter-profile:v1';
export const OBSIDIAN_LINTER_PROFILE_CHANGED_EVENT = 'mindos:obsidian-linter-profile-changed';

const STORAGE_VERSION = 1;
const DEFAULT_PROFILE = normalizeObsidianLinterRuleProfile();

let cachedRaw: string | null | undefined;
let cachedProfile: ObsidianLinterRuleProfile = DEFAULT_PROFILE;

interface StoredObsidianLinterProfile {
  version?: number;
  enabledRules?: unknown;
  maxConsecutiveBlankLines?: unknown;
}

export function readObsidianLinterProfilePreference(): ObsidianLinterRuleProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;

  const raw = readStorageRaw();
  if (raw === cachedRaw) return cachedProfile;

  cachedRaw = raw;
  cachedProfile = parseObsidianLinterProfilePreference(raw);
  return cachedProfile;
}

export function parseObsidianLinterProfilePreference(raw: string | null): ObsidianLinterRuleProfile {
  if (!raw) return DEFAULT_PROFILE;

  try {
    const parsed = JSON.parse(raw) as StoredObsidianLinterProfile;
    if (!isRecord(parsed)) return DEFAULT_PROFILE;

    return normalizeObsidianLinterRuleProfile({
      enabledRules: normalizeStoredEnabledRules(parsed.enabledRules),
      maxConsecutiveBlankLines: typeof parsed.maxConsecutiveBlankLines === 'number'
        ? parsed.maxConsecutiveBlankLines
        : undefined,
    });
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveObsidianLinterProfilePreference(
  profile: ObsidianLinterRuleProfileInput,
): ObsidianLinterRuleProfile {
  const normalized = normalizeObsidianLinterRuleProfile(profile);
  if (typeof window === 'undefined') return normalized;

  const payload = JSON.stringify({
    version: STORAGE_VERSION,
    enabledRules: normalized.enabledRules,
    maxConsecutiveBlankLines: normalized.maxConsecutiveBlankLines,
  });

  try {
    window.localStorage.setItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY, payload);
    cachedRaw = payload;
    cachedProfile = normalized;
  } catch {
    return normalized;
  }

  notifyObsidianLinterProfileChanged();
  return normalized;
}

export function updateObsidianLinterProfilePreference(
  updater: (profile: ObsidianLinterRuleProfile) => ObsidianLinterRuleProfileInput,
): ObsidianLinterRuleProfile {
  return saveObsidianLinterProfilePreference(updater(readObsidianLinterProfilePreference()));
}

export function setObsidianLinterRuleEnabled(
  ruleId: ObsidianLinterAdapterRuleId,
  enabled: boolean,
): ObsidianLinterRuleProfile {
  return updateObsidianLinterProfilePreference((profile) => ({
    ...profile,
    enabledRules: {
      ...profile.enabledRules,
      [ruleId]: enabled,
    },
  }));
}

export function setObsidianLinterMaxConsecutiveBlankLines(
  maxConsecutiveBlankLines: number,
): ObsidianLinterRuleProfile {
  return updateObsidianLinterProfilePreference((profile) => ({
    ...profile,
    maxConsecutiveBlankLines,
  }));
}

export function resetObsidianLinterProfilePreference(): ObsidianLinterRuleProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;

  try {
    window.localStorage.removeItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY);
    cachedRaw = null;
    cachedProfile = DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }

  notifyObsidianLinterProfileChanged();
  return DEFAULT_PROFILE;
}

export function useObsidianLinterProfile(): ObsidianLinterRuleProfile {
  return useSyncExternalStore(
    subscribeObsidianLinterProfile,
    readObsidianLinterProfilePreference,
    () => DEFAULT_PROFILE,
  );
}

function subscribeObsidianLinterProfile(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === OBSIDIAN_LINTER_PROFILE_STORAGE_KEY || event.key === null) callback();
  };
  const handleLocalChange = () => callback();

  window.addEventListener('storage', handleStorage);
  window.addEventListener(OBSIDIAN_LINTER_PROFILE_CHANGED_EVENT, handleLocalChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(OBSIDIAN_LINTER_PROFILE_CHANGED_EVENT, handleLocalChange);
  };
}

function normalizeStoredEnabledRules(value: unknown): ObsidianLinterRuleProfileInput['enabledRules'] {
  if (!isRecord(value)) return undefined;

  const enabledRules: Partial<Record<ObsidianLinterAdapterRuleId, boolean>> = {};
  for (const rule of OBSIDIAN_LINTER_RULE_METADATA) {
    const storedValue = value[rule.id];
    if (typeof storedValue === 'boolean') {
      enabledRules[rule.id] = storedValue;
    }
  }
  return enabledRules;
}

function notifyObsidianLinterProfileChanged() {
  window.dispatchEvent(new Event(OBSIDIAN_LINTER_PROFILE_CHANGED_EVENT));
}

function readStorageRaw(): string | null {
  try {
    return window.localStorage.getItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
