/**
 * Client-side mirror of "can /api/ask run?" using GET /api/settings payload.
 * Must stay aligned with server `effectiveAiConfig()` provider + key resolution.
 */
import { type ProviderId, PROVIDER_PRESETS, isProviderId } from './agent/providers';

export type SettingsJsonForAi = {
  ai?: {
    provider?: string;
    providers?: Partial<Record<string, { apiKey?: string }>>;
  };
  envOverrides?: Partial<Record<string, boolean>>;
};

export function isAiConfiguredForAsk(data: SettingsJsonForAi): boolean {
  const provId = data.ai?.provider;
  const provider: ProviderId = (provId && isProviderId(provId)) ? provId : 'anthropic';
  const preset = PROVIDER_PRESETS[provider];
  const env = data.envOverrides ?? {};

  const k = data.ai?.providers?.[provider]?.apiKey;
  if (typeof k === 'string' && k.length > 0) return true;

  if (preset.apiKeyEnvVar && env[preset.apiKeyEnvVar]) return true;

  return false;
}
