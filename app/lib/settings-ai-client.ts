/**
 * Client-side mirror of "can /api/ask run?" using GET /api/settings payload.
 * Must stay aligned with server `effectiveAiConfig()` provider + key resolution.
 */

export type SettingsJsonForAi = {
  ai?: {
    provider?: string;
    providers?: {
      anthropic?: { apiKey?: string };
      openai?: { apiKey?: string };
    };
  };
  envOverrides?: Partial<Record<'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY', boolean>>;
};

export function isAiConfiguredForAsk(data: SettingsJsonForAi): boolean {
  const prov = data.ai?.provider === 'openai' ? 'openai' : 'anthropic';
  const env = data.envOverrides ?? {};
  if (prov === 'openai') {
    const k = data.ai?.providers?.openai?.apiKey;
    return (typeof k === 'string' && k.length > 0) || !!env.OPENAI_API_KEY;
  }
  const k = data.ai?.providers?.anthropic?.apiKey;
  return (typeof k === 'string' && k.length > 0) || !!env.ANTHROPIC_API_KEY;
}
