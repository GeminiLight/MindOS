import { getModel as piGetModel, type Model } from '@mariozechner/pi-ai';
import { effectiveAiConfig } from '@/lib/settings';
import { type ProviderId, getPreset, toPiProvider, getDefaultApi, getDefaultBaseUrl } from './providers';

/** Check if any message in the conversation contains images */
export function hasImages(messages: Array<{ images?: unknown[] }>): boolean {
  return messages.some(m => m.images && m.images.length > 0);
}

function ensureVisionCapable(model: Model<any>): Model<any> {
  const inputs = model.input as readonly string[];
  if (inputs.includes('image')) return model;
  return { ...model, input: [...inputs, 'image'] as any };
}

export interface ModelConfigOverrides {
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  hasImages?: boolean;
}

/**
 * Build a pi-ai Model for any configured provider.
 *
 * Accepts optional overrides — used by test-key and list-models
 * to construct models from unsaved UI values.
 */
export function getModelConfig(options?: ModelConfigOverrides): {
  model: Model<any>;
  modelName: string;
  apiKey: string;
  provider: ProviderId;
  baseUrl: string;
} {
  const saved = effectiveAiConfig(options?.provider);

  const cfg = {
    provider: saved.provider,
    apiKey: options?.apiKey ?? saved.apiKey,
    model: options?.model ?? saved.model,
    baseUrl: options?.baseUrl ?? saved.baseUrl,
  };

  const modelName = cfg.model;
  let model = resolveModel(cfg.provider, modelName, cfg.baseUrl);

  if (options?.hasImages) {
    model = ensureVisionCapable(model);
  }

  return { model, modelName, apiKey: cfg.apiKey, provider: cfg.provider, baseUrl: cfg.baseUrl };
}

/**
 * Try pi-ai registry first, then fall back to a manually constructed Model.
 * Applies baseUrl overrides and compat flags for custom endpoints.
 */
function resolveModel(providerId: ProviderId, modelName: string, baseUrl: string): Model<any> {
  const piProvider = toPiProvider(providerId);
  const preset = getPreset(providerId);
  let model: Model<any>;
  const hasCustomBase = !!baseUrl;

  // 1. Try pi-ai registry lookup
  try {
    const resolved = piGetModel(piProvider as any, modelName as any);
    if (!resolved) throw new Error('Model not in registry');
    model = resolved;
  } catch {
    // 2. Fallback: construct minimal Model using pi-ai derived defaults
    model = {
      id: modelName,
      name: modelName,
      api: getDefaultApi(providerId) as any,
      provider: piProvider,
      baseUrl: preset.fixedBaseUrl || getDefaultBaseUrl(providerId),
      reasoning: false,
      input: ['text'] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
  }

  // 2.5. Apply preset fixedBaseUrl when registry lookup succeeded but needs endpoint override
  // (zai-cn: domestic endpoint, deepseek: fixed baseUrl, ollama: localhost)
  if (preset.fixedBaseUrl && !hasCustomBase) {
    model = { ...model, baseUrl: preset.fixedBaseUrl };
  }

  // 3. Apply user's custom baseUrl
  if (hasCustomBase) {
    model = { ...model, baseUrl };

    if (model.api === 'openai-responses') {
      model = { ...model, api: 'openai-completions' as any };
    }
  }

  // 4. For deepseek/zai-cn/ollama or any custom endpoint, apply conservative compat
  if (hasCustomBase || preset.fixedBaseUrl) {
    model = {
      ...model,
      compat: {
        ...(model as any).compat,
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        supportsStrictMode: false,
      },
    };
  }

  return model;
}
