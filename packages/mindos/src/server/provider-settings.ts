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
    });
  }
  return providers;
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
