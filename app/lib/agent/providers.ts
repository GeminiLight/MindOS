import {
  getModel as piGetModel,
  getModels as piGetModels,
  getEnvApiKey as piGetEnvApiKey,
  type Model,
  type KnownProvider,
} from '@mariozechner/pi-ai';

/**
 * MindOS-supported provider IDs.
 *
 * Most map 1:1 to pi-ai KnownProvider. The exception is `deepseek`,
 * which pi-ai doesn't have — we treat it as OpenAI-compatible with
 * a custom baseUrl.
 */
export type ProviderId =
  | 'anthropic' | 'openai' | 'google' | 'groq'
  | 'xai' | 'openrouter' | 'mistral' | 'deepseek'
  | 'zai' | 'zai-cn' | 'kimi-coding'
  | 'cerebras' | 'minimax' | 'minimax-cn' | 'huggingface'
  | 'ollama';

/**
 * UI/UX metadata for each provider.
 * Technical details (baseUrl, api protocol, auth, compat) are
 * delegated to pi-ai's model registry — we only store what pi-ai
 * doesn't provide.
 */
export interface ProviderPreset {
  id: ProviderId;
  name: string;
  nameZh: string;
  defaultModel: string;
  /** If ProviderId differs from pi-ai's KnownProvider (e.g. deepseek → openai) */
  piProviderOverride?: KnownProvider;
  /** DeepSeek/Ollama need a fixed baseUrl since they're not native pi-ai providers */
  fixedBaseUrl?: string;
  /** Dummy API key for providers that don't require auth (e.g. local Ollama) */
  apiKeyFallback?: string;
  supportsBaseUrl: boolean;
  supportsThinking: boolean;
  supportsListModels: boolean;
  signupUrl?: string;
  category: 'primary' | 'more';
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    nameZh: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    supportsBaseUrl: true,
    supportsThinking: true,
    supportsListModels: true,
    signupUrl: 'https://console.anthropic.com/settings/keys',
    category: 'primary',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    nameZh: 'OpenAI',
    defaultModel: 'gpt-5.4',
    supportsBaseUrl: true,
    supportsThinking: true,
    supportsListModels: true,
    signupUrl: 'https://platform.openai.com/api-keys',
    category: 'primary',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    nameZh: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    supportsBaseUrl: false,
    supportsThinking: true,
    supportsListModels: false,
    signupUrl: 'https://aistudio.google.com/apikey',
    category: 'primary',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    nameZh: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    supportsBaseUrl: false,
    supportsThinking: false,
    supportsListModels: true,
    signupUrl: 'https://console.groq.com/keys',
    category: 'more',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    nameZh: 'xAI (Grok)',
    defaultModel: 'grok-3',
    supportsBaseUrl: false,
    supportsThinking: false,
    supportsListModels: true,
    category: 'more',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    nameZh: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4',
    supportsBaseUrl: false,
    supportsThinking: false,
    supportsListModels: true,
    category: 'more',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    nameZh: 'Mistral',
    defaultModel: 'mistral-large-latest',
    supportsBaseUrl: false,
    supportsThinking: false,
    supportsListModels: true,
    category: 'more',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    nameZh: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    piProviderOverride: 'openai' as KnownProvider,
    fixedBaseUrl: 'https://api.deepseek.com/v1',
    supportsBaseUrl: true,
    supportsThinking: true,
    supportsListModels: true,
    signupUrl: 'https://platform.deepseek.com/api_keys',
    category: 'more',
  },
  zai: {
    id: 'zai',
    name: 'ZhipuAI (GLM)',
    nameZh: '智谱 AI (GLM 国际版)',
    defaultModel: 'glm-4-plus',
    supportsBaseUrl: false,
    supportsThinking: true,
    supportsListModels: false,
    category: 'more',
  },
  'zai-cn': {
    id: 'zai-cn',
    name: 'ZhipuAI (GLM China)',
    nameZh: '智谱 AI (GLM 国内版)',
    defaultModel: 'glm-4-plus',
    piProviderOverride: 'zai' as KnownProvider,
    fixedBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    supportsBaseUrl: false,
    supportsThinking: true,
    supportsListModels: false,
    signupUrl: 'https://open.bigmodel.cn/',
    category: 'more',
  },
  'kimi-coding': {
    id: 'kimi-coding',
    name: 'Kimi Coding',
    nameZh: 'Kimi Coding (月之暗面)',
    defaultModel: 'kimi-k2-thinking',
    supportsBaseUrl: false,
    supportsThinking: true,
    supportsListModels: false,
    category: 'more',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    nameZh: 'Cerebras',
    defaultModel: 'llama-4-scout-17b-16e',
    supportsBaseUrl: false,
    supportsThinking: false,
    supportsListModels: true,
    category: 'more',
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    nameZh: 'MiniMax (国际版)',
    defaultModel: 'MiniMax-M2.5',
    supportsBaseUrl: false,
    supportsThinking: true,
    supportsListModels: false,
    category: 'more',
  },
  'minimax-cn': {
    id: 'minimax-cn',
    name: 'MiniMax (China)',
    nameZh: 'MiniMax (国内版)',
    defaultModel: 'MiniMax-M2.5',
    supportsBaseUrl: false,
    supportsThinking: true,
    supportsListModels: false,
    category: 'more',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    nameZh: 'Hugging Face',
    defaultModel: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    supportsBaseUrl: false,
    supportsThinking: true,
    supportsListModels: false,
    category: 'more',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    nameZh: 'Ollama (本地)',
    defaultModel: 'llama3.2',
    piProviderOverride: 'openai' as KnownProvider,
    fixedBaseUrl: 'http://localhost:11434/v1',
    apiKeyFallback: 'ollama',
    supportsBaseUrl: true,
    supportsThinking: false,
    supportsListModels: true,
    signupUrl: 'https://ollama.com/download',
    category: 'more',
  },
};

export const ALL_PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[];

export function isProviderId(s: string): s is ProviderId {
  return s in PROVIDER_PRESETS;
}

export function getPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS[id] ?? PROVIDER_PRESETS.anthropic;
}

export function groupedProviders(): { primary: ProviderId[]; more: ProviderId[] } {
  const primary: ProviderId[] = [];
  const more: ProviderId[] = [];
  for (const id of ALL_PROVIDER_IDS) {
    if (PROVIDER_PRESETS[id].category === 'primary') primary.push(id);
    else more.push(id);
  }
  more.sort((a, b) => PROVIDER_PRESETS[a].name.localeCompare(PROVIDER_PRESETS[b].name));
  return { primary, more };
}

// ---------------------------------------------------------------------------
// Helpers that delegate to pi-ai — single source of truth for technical details
// ---------------------------------------------------------------------------

/** Map ProviderId to pi-ai's KnownProvider (handles deepseek → openai) */
export function toPiProvider(id: ProviderId): string {
  return PROVIDER_PRESETS[id].piProviderOverride ?? id;
}

/**
 * Get the env var name for a provider's API key, using pi-ai as source of truth.
 * DeepSeek is not in pi-ai, so we hardcode its env var.
 */
const EXTRA_ENV_KEYS: Partial<Record<ProviderId, string>> = {
  deepseek: 'DEEPSEEK_API_KEY',
};

export function getApiKeyEnvVar(id: ProviderId): string | undefined {
  if (EXTRA_ENV_KEYS[id]) return EXTRA_ENV_KEYS[id];
  return piEnvVarName(toPiProvider(id));
}

/** Read the actual API key from env for a provider */
export function getApiKeyFromEnv(id: ProviderId): string | undefined {
  if (id === 'deepseek') return process.env.DEEPSEEK_API_KEY;
  return piGetEnvApiKey(toPiProvider(id) as KnownProvider);
}

/**
 * Get the default baseUrl for a provider from pi-ai's model registry.
 * For deepseek, returns its fixed baseUrl.
 */
export function getDefaultBaseUrl(id: ProviderId): string {
  const preset = PROVIDER_PRESETS[id];
  if (preset.fixedBaseUrl) return preset.fixedBaseUrl;
  try {
    const models = piGetModels(toPiProvider(id) as any);
    return models[0]?.baseUrl ?? '';
  } catch {
    return '';
  }
}

/**
 * Get the default API type for a provider from pi-ai's model registry.
 * Used as fallback when constructing models not in the registry.
 */
export function getDefaultApi(id: ProviderId): string {
  try {
    const models = piGetModels(toPiProvider(id) as any);
    return models[0]?.api ?? 'openai-completions';
  } catch {
    return 'openai-completions';
  }
}

// ---------------------------------------------------------------------------
// Internal: reverse-engineer pi-ai's env var name mapping (for UI display)
// ---------------------------------------------------------------------------
const PI_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'azure-openai-responses': 'AZURE_OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  zai: 'ZAI_API_KEY',
  'zai-cn': 'ZAI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  'minimax-cn': 'MINIMAX_API_KEY',
  huggingface: 'HF_TOKEN',
  'kimi-coding': 'KIMI_API_KEY',
};

function piEnvVarName(piProvider: string): string | undefined {
  return PI_ENV_MAP[piProvider];
}
