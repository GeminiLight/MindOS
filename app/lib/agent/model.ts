import { getModel as piGetModel, type Model } from '@mariozechner/pi-ai';
import { effectiveAiConfig, type ProviderConfig } from '@/lib/settings';
import { type ProviderId, PROVIDER_PRESETS, getPreset } from './providers';

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
} {
  const saved = effectiveAiConfig();

  const cfg = {
    provider: options?.provider ?? saved.provider,
    apiKey: options?.apiKey ?? saved.apiKey,
    model: options?.model ?? saved.model,
    baseUrl: options?.baseUrl ?? saved.baseUrl,
  };

  const preset = getPreset(cfg.provider);
  const modelName = cfg.model;

  let model = resolveModel(preset, modelName, cfg.baseUrl);

  if (options?.hasImages) {
    model = ensureVisionCapable(model);
  }

  return { model, modelName, apiKey: cfg.apiKey, provider: cfg.provider };
}

/**
 * Try pi-ai registry first, then fall back to a manually constructed Model.
 * Applies baseUrl overrides and compat flags from the provider preset.
 */
function resolveModel(preset: typeof PROVIDER_PRESETS[ProviderId], modelName: string, baseUrl: string): Model<any> {
  let model: Model<any>;
  const hasCustomBase = !!baseUrl;

  try {
    const resolved = piGetModel(preset.piProvider as any, modelName as any);
    if (!resolved) throw new Error('Model not in registry');
    model = resolved;
  } catch {
    model = {
      id: modelName,
      name: modelName,
      api: preset.piApiDefault as any,
      provider: preset.piProvider,
      baseUrl: preset.defaultBaseUrl || '',
      reasoning: false,
      input: ['text'] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
  }

  if (hasCustomBase) {
    model = { ...model, baseUrl };

    // For custom endpoints, use completions API for max compatibility
    if (preset.piApiDefault === 'openai-responses' || model.api === 'openai-responses') {
      model = { ...model, api: 'openai-completions' as any };
    }
  }

  // Merge preset compat flags
  if (preset.compat || hasCustomBase) {
    const baseCompat = hasCustomBase ? {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
    } : {};

    model = {
      ...model,
      compat: { ...(model as any).compat, ...baseCompat, ...preset.compat },
    };
  }

  return model;
}

/** Get the effective provider's saved config (for API routes that read per-provider settings) */
export function getProviderConfig(provider: ProviderId): ProviderConfig | undefined {
  const { readSettings } = require('@/lib/settings');
  const s = readSettings();
  return s.ai.providers[provider];
}
