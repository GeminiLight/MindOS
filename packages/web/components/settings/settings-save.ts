import { apiFetch } from '@/lib/api';
import type { SettingsData } from './types';

const SETTINGS_JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

// Keep this list to fields owned by SettingsContent's parent form state.
// Fields with dedicated patch flows (ports, skill paths, MCP connection mode,
// runtime env) must stay out of autosave to avoid stale cross-tab overwrites.
export type SettingsSaveBody = {
  ai: SettingsData['ai'];
  agent: SettingsData['agent'];
  embedding: SettingsData['embedding'];
  webSearch: SettingsData['webSearch'];
  mindRoot: SettingsData['mindRoot'];
  webPassword: SettingsData['webPassword'];
  authToken: SettingsData['authToken'];
  allowNetworkAccess: boolean;
};

export type SettingsPatch = Partial<Pick<
  SettingsData,
  'connectionMode' | 'mcpPort' | 'port' | 'searchIgnoredPaths' | 'skillPaths'
>>;

export function buildSettingsSaveBody(data: SettingsData): SettingsSaveBody {
  return {
    ai: data.ai,
    agent: data.agent,
    embedding: data.embedding,
    webSearch: data.webSearch,
    mindRoot: data.mindRoot,
    webPassword: data.webPassword,
    authToken: data.authToken,
    allowNetworkAccess: data.allowNetworkAccess === true,
  };
}

function postSettings(body: SettingsSaveBody | SettingsPatch): Promise<unknown> {
  return apiFetch('/api/settings', {
    method: 'POST',
    headers: SETTINGS_JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function saveSettingsDocument(data: SettingsData): Promise<unknown> {
  return postSettings(buildSettingsSaveBody(data));
}

export function saveSettingsPatch(patch: SettingsPatch): Promise<unknown> {
  return postSettings(patch);
}
