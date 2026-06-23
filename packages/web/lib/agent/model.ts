import { effectiveAiConfig } from '@/lib/settings';
import type { Provider } from '@/lib/custom-endpoints';
import { resolveModelCapabilities, type ResolvedModelCapabilities } from './model-capabilities';
import { type ProviderId, getPreset, toPiProvider, getDefaultApi, getDefaultBaseUrl } from './providers';

type Model<T = unknown> = {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: readonly string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat?: Record<string, unknown>;
  mindosCaps?: ResolvedModelCapabilities;
} & T & Record<string, unknown>;

type PiAiRuntime = {
  getModel?: (provider: string, model: string) => Model<any> | undefined;
};

function loadPiAiRuntime(): PiAiRuntime | null {
  try {
    const requireFn = (0, eval)('require') as NodeRequire;
    return requireFn('@earendil-works/pi-ai') as PiAiRuntime;
  } catch {
    return null;
  }
}

/** Check if any message in the conversation contains images */
export function hasImages(messages: Array<{ images?: unknown[] }>): boolean {
  return messages.some(m => m.images && m.images.length > 0);
}

function ensureVisionCapable(model: Model<any>): Model<any> {
  const inputs = model.input as readonly string[];
  if (inputs.includes('image')) return model;
  return { ...model, input: [...inputs, 'image'] as any };
}

/**
 * Normalize a user-provided baseUrl without changing its semantic path.
 *
 * We only trim whitespace and trailing slashes. We intentionally do not
 * rewrite path segments like `/1` or `/v1`, because some gateways may use
 * custom prefixes and mutating them could break valid configurations.
 */
export function normalizeBaseUrl(url: string): string {
  if (!url) return url;
  return url.trim().replace(/\/+$/, '');
}

export interface ModelConfigOverrides {
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  hasImages?: boolean;
  providerEntry?: Provider;
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
  resolvedCaps: ResolvedModelCapabilities;
} {
  const saved = effectiveAiConfig(options?.provider);
  const provider = options?.provider ?? saved.provider;
  const hasExplicitConnectionOverride = options?.apiKey !== undefined
    || options?.model !== undefined
    || options?.baseUrl !== undefined;
  const providerEntry = options?.providerEntry
    ?? (hasExplicitConnectionOverride ? undefined : saved.providerEntry);

  const cfg = {
    provider,
    apiKey: options?.apiKey ?? saved.apiKey,
    model: options?.model ?? saved.model,
    baseUrl: options?.baseUrl ?? saved.baseUrl,
  };

  const modelName = cfg.model;
  const normalizedBaseUrl = normalizeBaseUrl(cfg.baseUrl);
  const resolved = resolveModel(cfg.provider, modelName, normalizedBaseUrl);
  const resolvedCaps = resolveModelCapabilities({
    providerEntry,
    protocol: cfg.provider,
    baseUrl: normalizedBaseUrl,
    modelId: modelName,
    registryModel: resolved.registryModel,
  });
  let model = {
    ...resolved.model,
    contextWindow: resolvedCaps.effectiveContextWindow,
    maxTokens: resolvedCaps.maxTokens ?? resolved.model.maxTokens,
    mindosCaps: resolvedCaps,
  };

  if (options?.hasImages) {
    model = ensureVisionCapable(model);
  }

  return { model, modelName, apiKey: cfg.apiKey, provider: cfg.provider, baseUrl: normalizedBaseUrl, resolvedCaps };
}

/**
 * Try pi-ai registry first, then fall back to a manually constructed Model.
 * Applies baseUrl overrides and compat flags for custom endpoints.
 */
function resolveModel(providerId: ProviderId, modelName: string, baseUrl: string): { model: Model<any>; registryModel?: Model<any> } {
  const piProvider = toPiProvider(providerId);
  const preset = getPreset(providerId);
  let model: Model<any>;

  // 1. Try pi-ai registry lookup
  try {
    const resolved = loadPiAiRuntime()?.getModel?.(piProvider, modelName);
    if (!resolved) throw new Error('Model not in registry');
    model = resolved;
    return { model: applyEndpointOverrides(model, providerId, baseUrl), registryModel: resolved };
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

  return { model: applyEndpointOverrides(model, providerId, baseUrl) };
}

function applyEndpointOverrides(model: Model<any>, providerId: ProviderId, baseUrl: string): Model<any> {
  const preset = getPreset(providerId);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const hasCustomBase = !!normalizedBaseUrl;

  // 2.5. Apply preset fixedBaseUrl when registry lookup succeeded but needs endpoint override
  // (zai-cn: domestic endpoint, deepseek: fixed baseUrl, ollama: localhost)
  if (preset.fixedBaseUrl && !hasCustomBase) {
    model = { ...model, baseUrl: preset.fixedBaseUrl };
  }

  // 3. Apply user's custom baseUrl
  if (hasCustomBase) {
    model = { ...model, baseUrl: normalizedBaseUrl };

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
