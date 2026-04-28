/**
 * Client-side mirror of "can /api/ask run?" using GET /api/settings payload.
 * Must stay aligned with server `effectiveAiConfig()` provider + key resolution.
 */
import { PROVIDER_PRESETS, isProviderId, getApiKeyEnvVar } from './agent/providers';
import { type Provider } from './custom-endpoints';

export type SettingsJsonForAi = {
  ai?: {
    activeProvider?: string;
    providers?: Provider[];
  };
  envOverrides?: Partial<Record<string, boolean>>;
};

export function isAiConfiguredForAsk(data: SettingsJsonForAi): boolean {
  const providers = data.ai?.providers ?? [];
  const activeId = data.ai?.activeProvider;
  const env = data.envOverrides ?? {};

  const current = activeId ? providers.find(p => p.id === activeId) : providers[0];
  if (!current) return false;

  // Has API key directly
  if (current.apiKey && current.apiKey.length > 0) return true;

  // Has env var override
  const envVar = isProviderId(current.protocol) ? getApiKeyEnvVar(current.protocol) : undefined;
  if (envVar && env[envVar]) return true;

  // Has fallback key (e.g. Ollama)
  const preset = isProviderId(current.protocol) ? PROVIDER_PRESETS[current.protocol] : undefined;
  if (preset?.apiKeyFallback) return true;

  return false;
}
