import { getModel as piGetModel, type Model } from '@mariozechner/pi-ai';
import { effectiveAiConfig } from '@/lib/settings';

/** Check if any message in the conversation contains images */
export function hasImages(messages: Array<{ images?: unknown[] }>): boolean {
  return messages.some(m => m.images && m.images.length > 0);
}

/** Ensure model input includes 'image' when images are present */
function ensureVisionCapable(model: Model<any>): Model<any> {
  const inputs = model.input as readonly string[];
  if (inputs.includes('image')) return model;
  // Upgrade input to include image — most modern models support it
  return { ...model, input: [...inputs, 'image'] as any };
}

/**
 * Build a pi-ai Model for the configured provider.
 *
 * - Anthropic: uses getModel() from pi-ai registry directly.
 * - OpenAI: uses getModel() then overrides baseUrl if custom endpoint is configured.
 *   Falls back to constructing a Model literal for unknown model IDs.
 *   Custom API variant can be specified for non-standard endpoints.
 *
 * Returns { model, modelName, apiKey } — Agent needs model + apiKey via getApiKey hook.
 */
export function getModelConfig(options?: { hasImages?: boolean }): {
  model: Model<any>;
  modelName: string;
  apiKey: string;
  provider: 'anthropic' | 'openai';
} {
  const cfg = effectiveAiConfig();

  if (cfg.provider === 'openai') {
    const modelName = cfg.openaiModel;
    let model: Model<any>;

    // API variant: 'openai-completions' = /chat/completions (widest compatibility),
    // 'openai-responses' = /responses (OpenAI native). Custom proxies (baseUrl set)
    // almost always only support chat completions, so default to that when baseUrl is set.
    const hasCustomBase = !!cfg.openaiBaseUrl;
    const defaultApi = hasCustomBase ? 'openai-completions' : 'openai-responses';
    const customApiVariant = (cfg as any).openaiApiVariant; // May exist in extended config

    try {
      const resolved = piGetModel('openai', modelName as any);
      if (!resolved) throw new Error('Model not in registry');
      model = resolved;
      // If user has a custom baseUrl, override API to completions for compatibility
      if (hasCustomBase && !customApiVariant) {
        model = { ...model, api: defaultApi };
      }
    } catch {
      // Model not in pi-ai registry — construct manually for custom/proxy endpoints
      model = {
        id: modelName,
        name: modelName,
        api: (customApiVariant ?? defaultApi) as any,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'] as const,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      };
    }

    // For custom proxy endpoints, set conservative compat flags.
    // Most proxies (Azure, Bedrock relays, corporate gateways) only support
    // a subset of OpenAI's features. These defaults prevent silent failures.
    // NOTE: maxTokensField is NOT overridden — pi-ai auto-detects the correct
    // field based on URL (defaults to max_completion_tokens for modern APIs).
    if (hasCustomBase) {
      model = {
        ...model,
        baseUrl: cfg.openaiBaseUrl,
        compat: {
          ...(model as any).compat,
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          supportsStrictMode: false,
        },
      };
      if (customApiVariant) {
        model = { ...model, api: customApiVariant };
      }
    }

    const finalModel = options?.hasImages ? ensureVisionCapable(model) : model;
    return { model: finalModel, modelName, apiKey: cfg.openaiApiKey, provider: 'openai' };
  }

  // Anthropic
  const modelName = cfg.anthropicModel;
  let model: Model<any>;

  try {
    const resolved = piGetModel('anthropic', modelName as any);
    if (!resolved) throw new Error('Model not in registry');
    model = resolved;
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

  const finalModel = options?.hasImages ? ensureVisionCapable(model) : model;
  return { model: finalModel, modelName, apiKey: cfg.anthropicApiKey, provider: 'anthropic' };
}
