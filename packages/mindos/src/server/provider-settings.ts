export type MindosProviderPreset = {
  name: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  apiKeyFallback?: string;
  supportsListModels: boolean;
  apiType: string;
  envKeys: string[];
  registryModels?: string[];
};

export type MindosProviderEntry = {
  id: string;
  name: string;
  protocol: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  models?: MindosProviderModelCapability[];
};

export type MindosProviderModelCapabilitySource =
  | 'user'
  | 'catalog'
  | 'discovered'
  | 'pi-ai'
  | 'fallback';

export type MindosProviderModelCapability = {
  id: string;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  input?: Array<'text' | 'image' | 'audio' | 'video'>;
  reasoning?: boolean;
  source?: MindosProviderModelCapabilitySource;
  updatedAt?: string;
};

const PROVIDER_ID_PREFIX = 'p_';

export const MINDOS_PROVIDER_PRESETS: Record<string, MindosProviderPreset> = {
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    supportsListModels: true,
    apiType: 'anthropic-messages',
    envKeys: ['ANTHROPIC_API_KEY'],
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-5.4',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: ['OPENAI_API_KEY'],
  },
  google: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsListModels: false,
    apiType: 'gemini',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    registryModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro'],
  },
  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: ['GROQ_API_KEY'],
  },
  xai: {
    name: 'xAI (Grok)',
    defaultModel: 'grok-3',
    defaultBaseUrl: 'https://api.x.ai/v1',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: ['XAI_API_KEY'],
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: ['OPENROUTER_API_KEY'],
  },
  mistral: {
    name: 'Mistral',
    defaultModel: 'mistral-large-latest',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: ['MISTRAL_API_KEY'],
  },
  deepseek: {
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: ['DEEPSEEK_API_KEY'],
  },
  zai: {
    name: 'ZhipuAI (GLM)',
    defaultModel: 'glm-4-plus',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    supportsListModels: false,
    apiType: 'openai-completions',
    envKeys: ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'],
    registryModels: ['glm-4-plus'],
  },
  'zai-cn': {
    name: 'ZhipuAI (GLM China)',
    defaultModel: 'glm-4-plus',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    supportsListModels: false,
    apiType: 'openai-completions',
    envKeys: ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'],
    registryModels: ['glm-4-plus'],
  },
  'kimi-coding': {
    name: 'Kimi Coding',
    defaultModel: 'kimi-k2-thinking',
    supportsListModels: false,
    apiType: 'anthropic-messages',
    envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    registryModels: ['kimi-k2-thinking'],
  },
  cerebras: {
    name: 'Cerebras',
    defaultModel: 'llama-4-scout-17b-16e',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: ['CEREBRAS_API_KEY'],
  },
  minimax: {
    name: 'MiniMax',
    defaultModel: 'MiniMax-M2.5',
    supportsListModels: false,
    apiType: 'anthropic-messages',
    envKeys: ['MINIMAX_API_KEY'],
    registryModels: ['MiniMax-M2.5'],
  },
  'minimax-cn': {
    name: 'MiniMax (China)',
    defaultModel: 'MiniMax-M2.5',
    supportsListModels: false,
    apiType: 'anthropic-messages',
    envKeys: ['MINIMAX_API_KEY'],
    registryModels: ['MiniMax-M2.5'],
  },
  huggingface: {
    name: 'Hugging Face',
    defaultModel: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    defaultBaseUrl: 'https://router.huggingface.co/v1',
    supportsListModels: false,
    apiType: 'openai-completions',
    envKeys: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
    registryModels: ['Qwen/Qwen3-235B-A22B-Thinking-2507'],
  },
  ollama: {
    name: 'Ollama',
    defaultModel: 'llama3.2',
    defaultBaseUrl: 'http://localhost:11434/v1',
    apiKeyFallback: 'ollama',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: [],
  },
  'lm-studio': {
    name: 'LM Studio',
    defaultModel: 'local-model',
    defaultBaseUrl: 'http://localhost:1234/v1',
    apiKeyFallback: 'lm-studio',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: [],
  },
  vllm: {
    name: 'vLLM',
    defaultModel: 'local-model',
    defaultBaseUrl: 'http://localhost:8000/v1',
    apiKeyFallback: 'vllm',
    supportsListModels: true,
    apiType: 'openai-completions',
    envKeys: [],
  },
};

export function isMindosProviderId(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(MINDOS_PROVIDER_PRESETS, value);
}

export function isMindosProviderEntryId(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PROVIDER_ID_PREFIX);
}

export function normalizeMindosProvider(entry: unknown): MindosProviderEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry as Record<string, unknown>;
  if (typeof source.id !== 'string' || !isMindosProviderEntryId(source.id)) return null;
  if (typeof source.protocol !== 'string' || !isMindosProviderId(source.protocol)) return null;
  if (typeof source.apiKey !== 'string') return null;
  if (typeof source.model !== 'string') return null;
  if (typeof source.baseUrl !== 'string') return null;

  const preset = MINDOS_PROVIDER_PRESETS[source.protocol]!;
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name
    : preset.name;

  return {
    id: source.id,
    name,
    protocol: source.protocol,
    apiKey: source.apiKey,
    model: source.model,
    baseUrl: source.baseUrl,
    ...normalizeMindosProviderCapabilityFields(source),
  };
}

export function parseMindosProviders(raw: unknown, activeProvider?: unknown): MindosProviderEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .map(normalizeMindosProvider)
      .filter((provider): provider is MindosProviderEntry => provider !== null);
  }

  if (!raw || typeof raw !== 'object') return [];
  const active = typeof activeProvider === 'string' ? activeProvider : '';
  const providers: MindosProviderEntry[] = [];
  for (const [protocol, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMindosProviderId(protocol)) continue;
    const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const apiKey = typeof source.apiKey === 'string' ? source.apiKey : '';
    const model = typeof source.model === 'string' ? source.model : '';
    const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl : '';
    if (!apiKey && !model && !baseUrl && protocol !== active) continue;

    const preset = MINDOS_PROVIDER_PRESETS[protocol]!;
    providers.push({
      id: `p_${protocol}`,
      name: preset.name,
      protocol,
      apiKey,
      model: model || preset.defaultModel,
      baseUrl: baseUrl || preset.defaultBaseUrl || '',
      ...normalizeMindosProviderCapabilityFields(source),
    });
  }
  return providers;
}

const MODEL_CAPABILITY_SOURCES = new Set<MindosProviderModelCapabilitySource>([
  'user',
  'catalog',
  'discovered',
  'pi-ai',
  'fallback',
]);

const MODEL_INPUT_MODALITIES = new Set(['text', 'image', 'audio', 'video']);

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeMindosModelInput(raw: unknown): MindosProviderModelCapability['input'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: NonNullable<MindosProviderModelCapability['input']> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || !MODEL_INPUT_MODALITIES.has(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item as NonNullable<MindosProviderModelCapability['input']>[number]);
  }
  return result.length > 0 ? result : undefined;
}

function normalizeMindosModelCapabilitySource(raw: unknown): MindosProviderModelCapabilitySource | undefined {
  return typeof raw === 'string' && MODEL_CAPABILITY_SOURCES.has(raw as MindosProviderModelCapabilitySource)
    ? raw as MindosProviderModelCapabilitySource
    : undefined;
}

function normalizeMindosProviderModelCapability(raw: unknown): MindosProviderModelCapability | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (!id) return null;

  const result: MindosProviderModelCapability = { id };
  const contextWindow = positiveInteger(source.contextWindow);
  const contextTokens = positiveInteger(source.contextTokens);
  const maxTokens = positiveInteger(source.maxTokens);
  const input = normalizeMindosModelInput(source.input);
  const capabilitySource = normalizeMindosModelCapabilitySource(source.source);

  if (contextWindow !== undefined) result.contextWindow = contextWindow;
  if (contextTokens !== undefined) result.contextTokens = contextTokens;
  if (maxTokens !== undefined) result.maxTokens = maxTokens;
  if (input) result.input = input;
  if (typeof source.reasoning === 'boolean') result.reasoning = source.reasoning;
  if (capabilitySource) result.source = capabilitySource;
  if (typeof source.updatedAt === 'string' && source.updatedAt.trim()) {
    result.updatedAt = source.updatedAt.trim();
  }

  return hasMeaningfulMindosModelCapability(result) ? result : null;
}

function hasMeaningfulMindosModelCapability(capability: MindosProviderModelCapability): boolean {
  return capability.contextWindow !== undefined
    || capability.contextTokens !== undefined
    || capability.maxTokens !== undefined
    || (capability.input !== undefined && capability.input.length > 0)
    || typeof capability.reasoning === 'boolean';
}

function normalizeMindosProviderCapabilityFields(
  source: Record<string, unknown>,
): Pick<MindosProviderEntry, 'contextWindow' | 'contextTokens' | 'maxTokens' | 'models'> {
  const result: Pick<MindosProviderEntry, 'contextWindow' | 'contextTokens' | 'maxTokens' | 'models'> = {};
  const contextWindow = positiveInteger(source.contextWindow);
  const contextTokens = positiveInteger(source.contextTokens);
  const maxTokens = positiveInteger(source.maxTokens);
  const models = Array.isArray(source.models)
    ? source.models
      .map(normalizeMindosProviderModelCapability)
      .filter((model): model is MindosProviderModelCapability => model !== null)
    : [];

  if (contextWindow !== undefined) result.contextWindow = contextWindow;
  if (contextTokens !== undefined) result.contextTokens = contextTokens;
  if (maxTokens !== undefined) result.maxTokens = maxTokens;
  if (models.length > 0) result.models = models;

  return result;
}

export function findMindosProvider(providers: unknown[], id: string): MindosProviderEntry | undefined {
  for (const provider of providers) {
    const normalized = normalizeMindosProvider(provider);
    if (normalized?.id === id) return normalized;
  }
  return undefined;
}

export function getMindosApiKeyFromEnv(provider: string, env: Record<string, string | undefined> = process.env): string {
  const preset = MINDOS_PROVIDER_PRESETS[provider];
  if (!preset) return '';
  for (const key of preset.envKeys) {
    const value = env[key];
    if (value) return value;
  }
  return '';
}

export function resolveMindosProviderConfig(
  settings: { ai?: { activeProvider?: string; providers?: unknown[] } },
  providerOverride?: string,
  env: Record<string, string | undefined> = process.env,
): { provider: string; apiKey: string; model: string; baseUrl: string } {
  const providers = parseMindosProviders(settings.ai?.providers, settings.ai?.activeProvider);

  let entry: MindosProviderEntry | undefined;
  const target = providerOverride || settings.ai?.activeProvider || '';
  if (target && isMindosProviderEntryId(target)) {
    entry = providers.find((provider) => provider.id === target);
  }
  if (!entry && target && isMindosProviderId(target)) {
    const active = providers.find((provider) => provider.id === settings.ai?.activeProvider);
    entry = active?.protocol === target
      ? active
      : providers.find((provider) => provider.protocol === target);
  }

  if (entry) {
    const preset = MINDOS_PROVIDER_PRESETS[entry.protocol]!;
    return {
      provider: entry.protocol,
      apiKey: entry.apiKey || getMindosApiKeyFromEnv(entry.protocol, env) || preset.apiKeyFallback || '',
      model: entry.model || preset.defaultModel,
      baseUrl: entry.baseUrl || preset.defaultBaseUrl || '',
    };
  }

  const protocol = target && isMindosProviderId(target)
    ? target
    : env.AI_PROVIDER && isMindosProviderId(env.AI_PROVIDER)
      ? env.AI_PROVIDER
      : 'anthropic';
  const preset = MINDOS_PROVIDER_PRESETS[protocol]!;
  return {
    provider: protocol,
    apiKey: getMindosApiKeyFromEnv(protocol, env) || preset.apiKeyFallback || '',
    model: preset.defaultModel,
    baseUrl: preset.defaultBaseUrl || '',
  };
}

export function buildMindosEndpointCandidates(baseUrl: string, path: string, apiType: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const hasVersionPrefix = /\/v\d+(?:$|\/)/.test(base);
  const candidates = new Set<string>();

  candidates.add(`${base}${cleanPath}`);
  if (!hasVersionPrefix && (
    apiType === 'openai-completions'
    || apiType === 'openai-responses'
    || apiType === 'anthropic-messages'
  )) {
    candidates.add(`${base}/v1${cleanPath}`);
  }

  return Array.from(candidates);
}
