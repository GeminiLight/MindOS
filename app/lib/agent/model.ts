import { getModel as piGetModel, type Model } from '@mariozechner/pi-ai';
import { effectiveAiConfig } from '@/lib/settings';

/**
 * Build a pi-ai Model for the configured provider.
 *
 * - Anthropic: uses getModel() from pi-ai registry directly.
 * - OpenAI: uses getModel() then overrides baseUrl if custom endpoint is configured.
 *   Falls back to constructing a Model literal for unknown model IDs.
 *
 * Returns { model, modelName, apiKey } — Agent needs model + apiKey via getApiKey hook.
 */
export function getModelConfig(): {
  model: Model<any>;
  modelName: string;
  apiKey: string;
  provider: 'anthropic' | 'openai';
} {
  const cfg = effectiveAiConfig();

  if (cfg.provider === 'openai') {
    const modelName = cfg.openaiModel;
    let model: Model<any>;

    try {
      model = piGetModel('openai', modelName as any);
    } catch {
      // Model not in pi-ai registry — construct manually for custom/proxy endpoints
      model = {
        id: modelName,
        name: modelName,
        api: 'openai-completions' as const,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'] as const,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      };
    }

    // Override baseUrl if user configured a custom endpoint
    if (cfg.openaiBaseUrl) {
      model = { ...model, baseUrl: cfg.openaiBaseUrl };
    }

    return { model, modelName, apiKey: cfg.openaiApiKey, provider: 'openai' };
  }

  // Anthropic
  const modelName = cfg.anthropicModel;
  let model: Model<any>;

  try {
    model = piGetModel('anthropic', modelName as any);
  } catch {
    // Unknown Anthropic model — construct manually
    model = {
      id: modelName,
      name: modelName,
      api: 'anthropic-messages' as const,
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      reasoning: false,
      input: ['text'] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 8_192,
    };
  }

  return { model, modelName, apiKey: cfg.anthropicApiKey, provider: 'anthropic' };
}
