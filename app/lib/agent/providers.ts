import type { Model } from '@mariozechner/pi-ai';

export type ProviderId =
  | 'anthropic' | 'openai' | 'google' | 'groq'
  | 'xai' | 'openrouter' | 'mistral' | 'deepseek'
  | 'zai' | 'kimi-coding'
  | 'cerebras' | 'minimax' | 'huggingface';

type ModelCompat = NonNullable<Model<any>['compat']>;

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  nameZh: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  supportsBaseUrl: boolean;
  authHeader: 'bearer' | 'x-api-key' | 'none';
  apiKeyEnvVar?: string;
  modelEnvVar?: string;
  baseUrlEnvVar?: string;
  piProvider: string;
  piApiDefault: string;
  compat?: Partial<ModelCompat>;
  supportsThinking: boolean;
  supportsListModels: boolean;
  listModelsEndpoint?: string;
  signupUrl?: string;
  category: 'primary' | 'secondary' | 'advanced';
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    nameZh: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    supportsBaseUrl: false,
    authHeader: 'x-api-key',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    modelEnvVar: 'ANTHROPIC_MODEL',
    piProvider: 'anthropic',
    piApiDefault: 'anthropic-messages',
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
    authHeader: 'bearer',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    modelEnvVar: 'OPENAI_MODEL',
    baseUrlEnvVar: 'OPENAI_BASE_URL',
    piProvider: 'openai',
    piApiDefault: 'openai-responses',
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
    authHeader: 'bearer',
    apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    modelEnvVar: 'GOOGLE_MODEL',
    piProvider: 'google',
    piApiDefault: 'google-generative-ai',
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
    authHeader: 'bearer',
    apiKeyEnvVar: 'GROQ_API_KEY',
    piProvider: 'groq',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    signupUrl: 'https://console.groq.com/keys',
    category: 'secondary',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    nameZh: 'xAI (Grok)',
    defaultModel: 'grok-3',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'XAI_API_KEY',
    piProvider: 'xai',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    category: 'secondary',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    nameZh: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    piProvider: 'openrouter',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    category: 'secondary',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    nameZh: 'Mistral',
    defaultModel: 'mistral-large-latest',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    piProvider: 'mistral',
    piApiDefault: 'mistral-conversations',
    supportsThinking: false,
    supportsListModels: true,
    category: 'secondary',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    nameZh: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    supportsBaseUrl: true,
    authHeader: 'bearer',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    piProvider: 'openai',
    piApiDefault: 'openai-completions',
    compat: { supportsDeveloperRole: false, supportsStore: false },
    supportsThinking: true,
    supportsListModels: true,
    signupUrl: 'https://platform.deepseek.com/api_keys',
    category: 'secondary',
  },
  zai: {
    id: 'zai',
    name: 'ZhipuAI (GLM)',
    nameZh: '智谱 AI (GLM)',
    defaultModel: 'glm-4-plus',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'ZAI_API_KEY',
    piProvider: 'zai',
    piApiDefault: 'openai-completions',
    supportsThinking: true,
    supportsListModels: false,
    category: 'secondary',
  },
  'kimi-coding': {
    id: 'kimi-coding',
    name: 'Kimi Coding',
    nameZh: 'Kimi Coding (月之暗面)',
    defaultModel: 'kimi-k2-thinking',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'KIMI_CODING_API_KEY',
    piProvider: 'kimi-coding',
    piApiDefault: 'anthropic-messages',
    supportsThinking: true,
    supportsListModels: false,
    category: 'secondary',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    nameZh: 'Cerebras',
    defaultModel: 'llama-4-scout-17b-16e',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'CEREBRAS_API_KEY',
    piProvider: 'cerebras',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: true,
    category: 'advanced',
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    nameZh: 'MiniMax',
    defaultModel: 'MiniMax-M1',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    piProvider: 'minimax',
    piApiDefault: 'openai-completions',
    supportsThinking: false,
    supportsListModels: false,
    category: 'advanced',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    nameZh: 'Hugging Face',
    defaultModel: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    supportsBaseUrl: false,
    authHeader: 'bearer',
    apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
    piProvider: 'huggingface',
    piApiDefault: 'openai-completions',
    supportsThinking: true,
    supportsListModels: false,
    category: 'advanced',
  },
};

export const ALL_PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[];

export function isProviderId(s: string): s is ProviderId {
  return s in PROVIDER_PRESETS;
}

export function getPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS[id] ?? PROVIDER_PRESETS.anthropic;
}

export function groupedProviders(): { primary: ProviderId[]; secondary: ProviderId[]; advanced: ProviderId[] } {
  const primary: ProviderId[] = [];
  const secondary: ProviderId[] = [];
  const advanced: ProviderId[] = [];
  for (const id of ALL_PROVIDER_IDS) {
    const cat = PROVIDER_PRESETS[id].category;
    if (cat === 'primary') primary.push(id);
    else if (cat === 'secondary') secondary.push(id);
    else advanced.push(id);
  }
  return { primary, secondary, advanced };
}
