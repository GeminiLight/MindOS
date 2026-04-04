import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseAcpAgentOverrides } from './acp/agent-descriptors';
import { type ProviderId, PROVIDER_PRESETS, isProviderId } from './agent/providers';

const SETTINGS_PATH = path.join(os.homedir(), '.mindos', 'config.json');

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AiConfig {
  provider: ProviderId;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
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
  setupPort?: number;      // temporary port used by GUI setup; cleared on completion
  disabledSkills?: string[];
  guideState?: GuideState;
  /** Per-agent ACP overrides (command, args, env, enabled). Keyed by agent ID. */
  acpAgents?: Record<string, import('./acp/agent-descriptors').AcpAgentOverride>;
}

const DEFAULTS: ServerSettings = {
  ai: {
    provider: 'anthropic' as ProviderId,
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

  const providerField = typeof ai.provider === 'string' ? ai.provider : 'anthropic';
  const provider: ProviderId = isProviderId(providerField) ? providerField : 'anthropic';

  // Already new format — parse all known providers from disk
  if (ai.providers && typeof ai.providers === 'object') {
    const p = ai.providers as Record<string, unknown>;
    const providers: Partial<Record<ProviderId, ProviderConfig>> = {};
    for (const id of Object.keys(p)) {
      if (!isProviderId(id)) continue;
      const preset = PROVIDER_PRESETS[id];
      const defaultCfg = DEFAULTS.ai.providers[id] ?? { apiKey: '', model: preset.defaultModel };
      providers[id] = parseProvider(p[id], defaultCfg);
    }
    // Ensure at least anthropic and openai exist (backward compat)
    if (!providers.anthropic) providers.anthropic = DEFAULTS.ai.providers.anthropic;
    if (!providers.openai) providers.openai = DEFAULTS.ai.providers.openai;
    return { provider, providers };
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

/** Parse acpAgents config field, delegates to agent-descriptors.ts */
function parseAcpAgentsField(raw: unknown): Record<string, import('./acp/agent-descriptors').AcpAgentOverride> | undefined {
  return parseAcpAgentOverrides(raw);
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
      acpAgents: parseAcpAgentsField(parsed.acpAgents),
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
  if (settings.acpAgents !== undefined) merged.acpAgents = settings.acpAgents;
  // setupPending: false/undefined → remove the field (cleanup); true → set it
  if ('setupPending' in settings) {
    if (settings.setupPending) merged.setupPending = true;
    else delete merged.setupPending;
  }
  // setupPort: clear when explicitly set to undefined/0 (setup completed)
  if ('setupPort' in settings) {
    if (settings.setupPort) merged.setupPort = settings.setupPort;
    else delete merged.setupPort;
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

/** Effective AI config — unified interface for all providers.
 *  Resolves: saved config → env var → preset default, in that priority order. */
export function effectiveAiConfig(): {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
} {
  const s = readSettings();
  const envProvider = process.env.AI_PROVIDER;
  const provider: ProviderId = isProviderId(s.ai.provider)
    ? s.ai.provider
    : (envProvider && isProviderId(envProvider) ? envProvider : 'anthropic');

  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.anthropic;
  const provCfg = s.ai.providers[provider] ?? {};

  const apiKey = provCfg.apiKey
    || (preset.apiKeyEnvVar ? process.env[preset.apiKeyEnvVar] : '')
    || '';
  const model = provCfg.model
    || (preset.modelEnvVar ? process.env[preset.modelEnvVar] : '')
    || preset.defaultModel;
  const baseUrl = provCfg.baseUrl
    || (preset.baseUrlEnvVar ? process.env[preset.baseUrlEnvVar] : '')
    || preset.defaultBaseUrl
    || '';

  return { provider, apiKey, model, baseUrl };
}

/** Effective MIND_ROOT — settings file can override, env var is fallback */
export function effectiveSopRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
}
