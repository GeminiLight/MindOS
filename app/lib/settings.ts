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

export interface AgentConfig {
  maxSteps?: number;          // default 20, range 1-30
  enableThinking?: boolean;   // default false, Anthropic only
  thinkingBudget?: number;    // default 5000
  contextStrategy?: 'auto' | 'off'; // default 'auto'
  reconnectRetries?: number;  // default 3, range 0-10 (0 = disabled)
}

export interface GuideState {
  active: boolean;        // setup 完成时写入 true
  dismissed: boolean;     // 用户关闭 Guide Card 时写入 true
  template: 'en' | 'zh' | 'empty';  // setup 时写入
  step1Done: boolean;     // 至少浏览过 1 个文件
  askedAI: boolean;       // 至少发过 1 条 AI 消息
  nextStepIndex: number;  // 0=C2, 1=C3, 2=C4, 3=全部完成
  walkthroughStep?: number;     // undefined=not started, 0-3=current step, 4=completed
  walkthroughDismissed?: boolean; // user skipped walkthrough
}

export interface ServerSettings {
  ai: AiConfig;
  agent?: AgentConfig;
  mindRoot: string;   // empty = use env var / default
  port?: number;
  mcpPort?: number;
  authToken?: string;
  webPassword?: string;
  startMode?: 'dev' | 'start' | 'daemon';
  setupPending?: boolean;  // true → / redirects to /setup
  disabledSkills?: string[];
  guideState?: GuideState;
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

/** Parse agent config from unknown input */
function parseAgent(raw: unknown): AgentConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const result: AgentConfig = {};
  if (typeof obj.maxSteps === 'number') result.maxSteps = Math.min(30, Math.max(1, obj.maxSteps));
  if (typeof obj.enableThinking === 'boolean') result.enableThinking = obj.enableThinking;
  if (typeof obj.thinkingBudget === 'number') result.thinkingBudget = Math.min(50000, Math.max(1000, obj.thinkingBudget));
  if (obj.contextStrategy === 'auto' || obj.contextStrategy === 'off') result.contextStrategy = obj.contextStrategy;
  if (typeof obj.reconnectRetries === 'number') result.reconnectRetries = Math.min(10, Math.max(0, obj.reconnectRetries));
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Parse guideState from unknown input */
function parseGuideState(raw: unknown): GuideState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.active !== true) return undefined;
  const template = obj.template === 'en' || obj.template === 'zh' || obj.template === 'empty'
    ? obj.template : 'en';
  return {
    active: true,
    dismissed: obj.dismissed === true,
    template,
    step1Done: obj.step1Done === true,
    askedAI: obj.askedAI === true,
    nextStepIndex: typeof obj.nextStepIndex === 'number' ? obj.nextStepIndex : 0,
    walkthroughStep: typeof obj.walkthroughStep === 'number' ? obj.walkthroughStep : undefined,
    walkthroughDismissed: typeof obj.walkthroughDismissed === 'boolean' ? obj.walkthroughDismissed : undefined,
  };
}

export function readSettings(): ServerSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ai: migrateAi(parsed),
      agent: parseAgent(parsed.agent),
      mindRoot: (parsed.mindRoot ?? parsed.sopRoot ?? DEFAULTS.mindRoot) as string,
      webPassword: typeof parsed.webPassword === 'string' ? parsed.webPassword : undefined,
      authToken:   typeof parsed.authToken   === 'string' ? parsed.authToken   : undefined,
      mcpPort:     typeof parsed.mcpPort     === 'number' ? parsed.mcpPort     : undefined,
      port:        typeof parsed.port        === 'number' ? parsed.port        : undefined,
      startMode:   typeof parsed.startMode   === 'string' ? parsed.startMode as ServerSettings['startMode'] : undefined,
      setupPending: parsed.setupPending === true ? true : undefined,
      disabledSkills: Array.isArray(parsed.disabledSkills) ? parsed.disabledSkills as string[] : undefined,
      guideState: parseGuideState(parsed.guideState),
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
  if (settings.agent !== undefined) merged.agent = settings.agent;
  if (settings.webPassword !== undefined) merged.webPassword = settings.webPassword;
  if (settings.authToken   !== undefined) merged.authToken   = settings.authToken;
  if (settings.port        !== undefined) merged.port        = settings.port;
  if (settings.mcpPort     !== undefined) merged.mcpPort     = settings.mcpPort;
  if (settings.startMode   !== undefined) merged.startMode   = settings.startMode;
  if (settings.disabledSkills !== undefined) merged.disabledSkills = settings.disabledSkills;
  if (settings.guideState !== undefined) merged.guideState = settings.guideState;
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
