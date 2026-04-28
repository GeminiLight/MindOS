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
  | 'ollama' | 'lm-studio' | 'vllm';

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
  shortLabel: string; // 3-8 char label for capsule display (e.g., 'Claude', 'GPT', 'GLM-CN')
  description?: string; // Helper text for settings (e.g., "China region version")
  descriptionZh?: string; // Chinese helper text
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
  category: 'primary' | 'local' | 'more';
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    nameZh: 'Anthropic',
    shortLabel: 'Anthropic',
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
    shortLabel: 'OpenAI',
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
    shortLabel: 'Gemini',
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
    shortLabel: 'Groq',
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
    shortLabel: 'xAI',
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
    shortLabel: 'OpenRouter',
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
    shortLabel: 'Mistral',
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
    shortLabel: 'DeepSeek',
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
    shortLabel: '智谱GLM',
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
    shortLabel: '智谱GLM-CN',
    description: 'China region version',
    descriptionZh: '中国区版本',
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
    shortLabel: 'Kimi Coding',
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
    shortLabel: 'Cerebras',
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
    shortLabel: 'MiniMax',
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
    shortLabel: 'MiniMax-CN',
    description: 'China region version',
    descriptionZh: '中国区版本',
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
    shortLabel: 'HuggingFace',
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
    shortLabel: 'Ollama',
    description: 'Local server (requires setup)',
    descriptionZh: '本地服务器 (需要本地部署)',
    defaultModel: 'llama3.2',
    piProviderOverride: 'openai' as KnownProvider,
    fixedBaseUrl: 'http://localhost:11434/v1',
    apiKeyFallback: 'ollama',
    supportsBaseUrl: true,
    supportsThinking: false,
    supportsListModels: true,
    signupUrl: 'https://ollama.com/download',
    category: 'local',
  },
  'lm-studio': {
    id: 'lm-studio',
    name: 'LM Studio',
    nameZh: 'LM Studio (本地)',
    shortLabel: 'LM Studio',
    description: 'Local OpenAI-compatible server',
    descriptionZh: '本地 OpenAI 兼容服务',
    defaultModel: 'local-model',
    piProviderOverride: 'openai' as KnownProvider,
    fixedBaseUrl: 'http://localhost:1234/v1',
    apiKeyFallback: 'lm-studio',
    supportsBaseUrl: true,
    supportsThinking: false,
    supportsListModels: true,
    signupUrl: 'https://lmstudio.ai/',
    category: 'local',
  },
  vllm: {
    id: 'vllm',
    name: 'vLLM',
    nameZh: 'vLLM (本地)',
    shortLabel: 'vLLM',
    description: 'Local OpenAI-compatible server',
    descriptionZh: '本地 OpenAI 兼容服务',
    defaultModel: 'local-model',
    piProviderOverride: 'openai' as KnownProvider,
    fixedBaseUrl: 'http://localhost:8000/v1',
    apiKeyFallback: 'vllm',
    supportsBaseUrl: true,
    supportsThinking: false,
    supportsListModels: true,
    signupUrl: 'https://docs.vllm.ai/',
    category: 'local',
  },
};

export const ALL_PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[];

export function isProviderId(s: string): s is ProviderId {
  return s in PROVIDER_PRESETS;
}

export function getPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS[id] ?? PROVIDER_PRESETS.anthropic;
}

export function groupedProviders(): { primary: ProviderId[]; local: ProviderId[]; more: ProviderId[] } {
  const primary: ProviderId[] = [];
  const local: ProviderId[] = [];
  const more: ProviderId[] = [];
  for (const id of ALL_PROVIDER_IDS) {
    const category = PROVIDER_PRESETS[id].category;
    if (category === 'primary') primary.push(id);
    else if (category === 'local') local.push(id);
    else more.push(id);
  }
  local.sort((a, b) => PROVIDER_PRESETS[a].name.localeCompare(PROVIDER_PRESETS[b].name));
  more.sort((a, b) => PROVIDER_PRESETS[a].name.localeCompare(PROVIDER_PRESETS[b].name));
  return { primary, local, more };
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

/** Return the effective API type used by a provider (openai-completions, anthropic-messages, etc.). */
export function getProviderApiType(id: ProviderId): string {
  return getDefaultApi(id);
}

/**
 * Build endpoint candidates for compatible providers.
 *
 * We do not assume whether the user-supplied baseUrl already includes a version
 * prefix. For OpenAI- and Anthropic-compatible gateways we try both forms:
 *   1. base + path
 *   2. base + /v1 + path (if base does not already appear to contain a /vN segment)
 *
 * IMPORTANT: the /vN detection below is heuristic, not semantic. Some providers
 * (such as GLM's .../v4 path) use version-looking segments as part of their API
 * base path. We intentionally prefer preserving user/provider paths over forcing
 * another /v1 segment, because mutating a valid custom path is worse than trying
 * a conservative fallback.
 */
export function buildCompatEndpointCandidates(baseUrl: string, path: string, apiType: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const hasVersionPrefix = /\/v\d+(?:$|\/)/.test(base);
  const candidates = new Set<string>();

  candidates.add(`${base}${cleanPath}`);

  if (!hasVersionPrefix && (apiType === 'openai-completions' || apiType === 'openai-responses' || apiType === 'anthropic-messages')) {
    candidates.add(`${base}/v1${cleanPath}`);
  }

  return Array.from(candidates);
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
