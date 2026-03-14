import fs from 'fs';
import path from 'path';
import os from 'os';

const SETTINGS_PATH = path.join(os.homedir(), '.mindos', 'config.json');

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string; // only for openai-compatible providers
}

export interface AiConfig {
  provider: 'anthropic' | 'openai';
  providers: {
    anthropic: ProviderConfig;
    openai: ProviderConfig;
  };
}

export interface ServerSettings {
  ai: AiConfig;
  mindRoot: string;   // empty = use env var / default
  port?: number;
  mcpPort?: number;
  authToken?: string;
  webPassword?: string;
  startMode?: 'dev' | 'start' | 'daemon';
  setupPending?: boolean;  // true → / redirects to /setup
  disabledSkills?: string[];
}

const DEFAULTS: ServerSettings = {
  ai: {
    provider: 'anthropic',
    providers: {
      anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
      openai:    { apiKey: '', model: 'gpt-5.4', baseUrl: '' },
    },
  },
  mindRoot: '',
};

/** Safely extract a string field from an unknown object, returning fallback if missing or wrong type */
function str(obj: unknown, key: string, fallback: string): string {
  if (obj && typeof obj === 'object') {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === 'string' && val.trim() !== '') return val;
  }
  return fallback;
}

/** Parse a provider config from unknown input, filling missing/invalid fields with defaults */
function parseProvider(raw: unknown, defaults: ProviderConfig): ProviderConfig {
  return {
    apiKey:   str(raw, 'apiKey',  defaults.apiKey),
    model:    str(raw, 'model',   defaults.model),
    ...(defaults.baseUrl !== undefined
      ? { baseUrl: str(raw, 'baseUrl', defaults.baseUrl) }
      : {}),
  };
}

/** Migrate old flat ai structure to new providers dict, if needed */
function migrateAi(parsed: Record<string, unknown>): AiConfig {
  const ai = parsed.ai as Record<string, unknown> | undefined;
  if (!ai) return { ...DEFAULTS.ai };

  const providerField = ai.provider;
  const provider: 'anthropic' | 'openai' =
    providerField === 'anthropic' || providerField === 'openai' ? providerField : 'anthropic';

  // Already new format
  if (ai.providers && typeof ai.providers === 'object') {
    const p = ai.providers as Record<string, unknown>;
    return {
      provider,
      providers: {
        anthropic: parseProvider(p.anthropic, DEFAULTS.ai.providers.anthropic),
        openai:    parseProvider(p.openai,    DEFAULTS.ai.providers.openai),
      },
    };
  }

  // Old flat format — migrate
  return {
    provider,
    providers: {
      anthropic: {
        apiKey: str(ai, 'anthropicApiKey', ''),
        model:  str(ai, 'anthropicModel',  'claude-sonnet-4-6'),
      },
      openai: {
        apiKey:   str(ai, 'openaiApiKey',  ''),
        model:    str(ai, 'openaiModel',   'gpt-5.4'),
        baseUrl:  str(ai, 'openaiBaseUrl', ''),
      },
    },
  };
}

export function readSettings(): ServerSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ai: migrateAi(parsed),
      mindRoot: (parsed.mindRoot ?? parsed.sopRoot ?? DEFAULTS.mindRoot) as string,
      webPassword: typeof parsed.webPassword === 'string' ? parsed.webPassword : undefined,
      authToken:   typeof parsed.authToken   === 'string' ? parsed.authToken   : undefined,
      mcpPort:     typeof parsed.mcpPort     === 'number' ? parsed.mcpPort     : undefined,
      port:        typeof parsed.port        === 'number' ? parsed.port        : undefined,
      startMode:   typeof parsed.startMode   === 'string' ? parsed.startMode as ServerSettings['startMode'] : undefined,
      setupPending: parsed.setupPending === true ? true : undefined,
      disabledSkills: Array.isArray(parsed.disabledSkills) ? parsed.disabledSkills as string[] : undefined,
    };
  } catch {
    return { ...DEFAULTS, ai: { ...DEFAULTS.ai, providers: { ...DEFAULTS.ai.providers } } };
  }
}

export function writeSettings(settings: ServerSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Merge into existing config to preserve fields like port, authToken, mcpPort
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')); } catch { /* ignore */ }
  const merged: Record<string, unknown> = { ...existing, ai: settings.ai, mindRoot: settings.mindRoot };
  if (settings.webPassword !== undefined) merged.webPassword = settings.webPassword;
  if (settings.authToken   !== undefined) merged.authToken   = settings.authToken;
  if (settings.port        !== undefined) merged.port        = settings.port;
  if (settings.mcpPort     !== undefined) merged.mcpPort     = settings.mcpPort;
  if (settings.startMode   !== undefined) merged.startMode   = settings.startMode;
  if (settings.disabledSkills !== undefined) merged.disabledSkills = settings.disabledSkills;
  // setupPending: false/undefined → remove the field (cleanup); true → set it
  if ('setupPending' in settings) {
    if (settings.setupPending) merged.setupPending = true;
    else delete merged.setupPending;
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

/** Effective AI config — settings file overrides env vars when non-empty */
export function effectiveAiConfig() {
  const s = readSettings();
  const provider = (s.ai.provider || process.env.AI_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
  const anthropic = s.ai.providers.anthropic;
  const openai    = s.ai.providers.openai;

  return {
    provider,
    anthropicApiKey: anthropic.apiKey || process.env.ANTHROPIC_API_KEY || '',
    anthropicModel:  anthropic.model  || process.env.ANTHROPIC_MODEL   || 'claude-sonnet-4-6',
    openaiApiKey:    openai.apiKey    || process.env.OPENAI_API_KEY    || '',
    openaiModel:     openai.model     || process.env.OPENAI_MODEL      || 'gpt-5.4',
    openaiBaseUrl:   openai.baseUrl   || process.env.OPENAI_BASE_URL   || '',
  };
}

/** Effective MIND_ROOT — settings file can override, env var is fallback */
export function effectiveSopRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
}
