/* ── Chrome Storage Wrapper ── */

import type { ClipperConfig } from './types';

const STORAGE_KEY = 'mindos_clipper_config';

const DEFAULT_CONFIG: ClipperConfig = {
  mindosUrl: 'http://localhost:3456',
  authToken: '',
  defaultSpace: 'Clips',
  connected: false,
};

/** Read config from chrome.storage.local */
export async function loadConfig(): Promise<ClipperConfig> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (!stored) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...stored };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save config to chrome.storage.local */
export async function saveConfig(config: Partial<ClipperConfig>): Promise<ClipperConfig> {
  const current = await loadConfig();
  const merged = { ...current, ...config };
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  return merged;
}

/** Check if extension is configured (has URL + token) */
export function isConfigured(config: ClipperConfig): boolean {
  return !!config.mindosUrl && !!config.authToken;
}
