const SECRET_KEY_PATTERN = /(?:api[-_]?key|auth[-_]?token|password|secret|token)$/i;

const NO_KEY_PROTOCOLS = new Set(['ollama', 'lm-studio', 'vllm']);

const OLD_PROVIDER_NAMES = ['anthropic', 'openai'];

const PROVIDER_ENV_KEYS = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  xai: ['XAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  requesty: ['REQUESTY_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  zai: ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'],
  'zai-cn': ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-cn': ['MINIMAX_API_KEY'],
  huggingface: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
};

export function maskSecret(value) {
  if (typeof value !== 'string') return value;
  if (!value) return value;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 6)}****`;
}

export function redactSecrets(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (!value || typeof value !== 'object') {
    return SECRET_KEY_PATTERN.test(key) ? maskSecret(value) : value;
  }

  const redacted = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    redacted[childKey] = SECRET_KEY_PATTERN.test(childKey)
      ? maskSecret(childValue)
      : redactSecrets(childValue, childKey);
  }
  return redacted;
}

function normalizeProviderEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id : '';
  const protocol = typeof entry.protocol === 'string' ? entry.protocol : '';
  if (!id || !protocol) return null;

  return {
    id,
    protocol,
    name: typeof entry.name === 'string' ? entry.name : '',
    apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : '',
    model: typeof entry.model === 'string' ? entry.model : '',
    baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : '',
  };
}

function normalizeProviderDict(providers, activeProvider = '') {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return [];

  return Object.entries(providers)
    .map(([protocol, raw]) => {
      if (!raw || typeof raw !== 'object') return null;
      const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
      const model = typeof raw.model === 'string' ? raw.model : '';
      const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl : '';
      if (!apiKey && !model && !baseUrl && activeProvider !== protocol) return null;
      return {
        id: `p_${protocol}`,
        protocol,
        name: typeof raw.name === 'string' ? raw.name : '',
        apiKey,
        model,
        baseUrl,
      };
    })
    .filter(Boolean);
}

export function resolveAiConfig(ai = {}) {
  const source = ai && typeof ai === 'object' ? ai : {};
  const explicitActive = typeof source.activeProvider === 'string'
    ? source.activeProvider
    : (typeof source.provider === 'string' ? source.provider : '');

  let providers = [];
  if (Array.isArray(source.providers)) {
    providers = source.providers.map(normalizeProviderEntry).filter(Boolean);
  } else {
    providers = normalizeProviderDict(source.providers, explicitActive);
  }

  for (const protocol of OLD_PROVIDER_NAMES) {
    const apiKey = typeof source[`${protocol}ApiKey`] === 'string' ? source[`${protocol}ApiKey`] : '';
    const model = typeof source[`${protocol}Model`] === 'string' ? source[`${protocol}Model`] : '';
    const baseUrl = typeof source[`${protocol}BaseUrl`] === 'string' ? source[`${protocol}BaseUrl`] : '';
    const alreadyPresent = providers.some((provider) => provider.protocol === protocol);
    if (!alreadyPresent && (apiKey || model || baseUrl || explicitActive === protocol)) {
      providers.push({
        id: `p_${protocol}`,
        protocol,
        name: '',
        apiKey,
        model,
        baseUrl,
      });
    }
  }

  const activeEntry = (() => {
    if (!explicitActive || explicitActive === 'skip') return null;
    return providers.find((provider) => provider.id === explicitActive)
      || providers.find((provider) => provider.protocol === explicitActive)
      || null;
  })() || (explicitActive === 'skip' ? null : providers[0] || null);

  const activeProvider = explicitActive === 'skip'
    ? 'skip'
    : (activeEntry?.id || providers[0]?.id || '');

  return {
    activeProvider,
    activeEntry,
    providers,
  };
}

export function isProviderMissingRequiredKey(provider) {
  if (!provider) return false;
  if (NO_KEY_PROTOCOLS.has(provider.protocol)) return false;
  return !provider.apiKey;
}

export function hasProviderEnvKey(provider, env = process.env) {
  if (!provider) return false;
  const keys = PROVIDER_ENV_KEYS[provider.protocol] || [];
  return keys.some((key) => typeof env[key] === 'string' && env[key]);
}

export function providerEnvKeys(provider) {
  if (!provider) return [];
  return PROVIDER_ENV_KEYS[provider.protocol] || [];
}
