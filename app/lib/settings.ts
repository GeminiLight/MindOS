import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseAcpAgentOverrides } from './acp/agent-descriptors';
import { type ProviderId, PROVIDER_PRESETS, isProviderId, getApiKeyFromEnv } from './agent/providers';
import { type Provider, parseProviders, findProvider, migrateProviders } from './custom-endpoints';
// Backward compat re-exports for files still importing from settings
export type { Provider };

const SETTINGS_PATH = path.join(os.homedir(), '.mindos', 'config.json');

/** @deprecated Use Provider from custom-endpoints.ts */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AiConfig {
  activeProvider: string;    // provider entry ID (p_*)
  providers: Provider[];     // unified provider list
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
  /** Proxy compatibility cache: keyed by baseUrl, value is detected mode. */
  baseUrlCompat?: Record<string, 'streaming' | 'non-streaming'>;
  /** User's connection mode preference: CLI always on, MCP is optional */
  connectionMode?: {
    cli: boolean;   // Always true (CLI is mandatory)
    mcp: boolean;   // User's explicit choice during onboarding
  };
  /** User-defined agents not built into MindOS. */
  customAgents?: import('./custom-agents').CustomAgentDef[];
  // customProviders is now merged into ai.providers — kept for migration only
}

const DEFAULTS: ServerSettings = {
  ai: {
    activeProvider: '',
    providers: [],
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

/** Migrate old flat ai structure to new providers dict, if needed */
function migrateAi(parsed: Record<string, unknown>): AiConfig {
  const ai = parsed.ai as Record<string, unknown> | undefined;
  if (!ai) return { ...DEFAULTS.ai };

  // ── New format: ai.providers is an array ──
  if (Array.isArray(ai.providers)) {
    const providers = parseProviders(ai.providers);
    const activeProvider = typeof ai.activeProvider === 'string' ? ai.activeProvider : '';
    return { activeProvider, providers };
  }

  // ── Old format: ai.providers is a dict (or missing) → auto-migrate ──
  const migrated = migrateProviders(parsed);
  if (migrated) {
    return { activeProvider: migrated.activeProvider, providers: migrated.providers };
  }

  // Very old flat format (anthropicApiKey etc.) — also handled by migrateProviders
  // but if it returns null, fall through to defaults
  return { ...DEFAULTS.ai };
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

/** Infer connectionMode from old config.
 *  Old configs don't have connectionMode — both CLI and MCP were always available.
 *  So we default to { cli: true, mcp: true } for existing users to avoid breaking change. */
function inferConnectionMode(parsed: Record<string, unknown>): { cli: boolean; mcp: boolean } {
  // If already has explicit connectionMode, return it
  if (parsed.connectionMode && typeof parsed.connectionMode === 'object') {
    const obj = parsed.connectionMode as Record<string, unknown>;
    if (typeof obj.cli === 'boolean' && typeof obj.mcp === 'boolean') {
      return { cli: obj.cli, mcp: obj.mcp };
    }
  }
  // Old config without connectionMode: default to both enabled (backwards-compat)
  // Only fresh installs (setupPending=true or missing config) get mcp: false
  const isNewInstall = parsed.setupPending === true || !parsed.mindRoot;
  return {
    cli: true,
    mcp: !isNewInstall, // Existing users keep MCP, new users start with CLI-only
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
      mindRoot: (parsed.mindRoot ?? DEFAULTS.mindRoot) as string,
      webPassword: typeof parsed.webPassword === 'string' ? parsed.webPassword : undefined,
      authToken:   typeof parsed.authToken   === 'string' ? parsed.authToken   : undefined,
      mcpPort:     typeof parsed.mcpPort     === 'number' ? parsed.mcpPort     : undefined,
      port:        typeof parsed.port        === 'number' ? parsed.port        : undefined,
      startMode:   typeof parsed.startMode   === 'string' ? parsed.startMode as ServerSettings['startMode'] : undefined,
      setupPending: parsed.setupPending === true ? true : undefined,
      disabledSkills: Array.isArray(parsed.disabledSkills) ? parsed.disabledSkills as string[] : undefined,
      guideState: parseGuideState(parsed.guideState),
      baseUrlCompat: (() => {
        const raw = parsed.baseUrlCompat;
        if (!raw || typeof raw !== 'object') return undefined;
        const result: Record<string, 'streaming' | 'non-streaming'> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v === 'streaming' || v === 'non-streaming') result[k] = v;
        }
        return Object.keys(result).length > 0 ? result : undefined;
      })(),
      connectionMode: inferConnectionMode(parsed),
      customAgents: Array.isArray(parsed.customAgents) ? parsed.customAgents as import('./custom-agents').CustomAgentDef[] : undefined,
    };
  } catch {
    // Config file missing or corrupt → force setup wizard
    return {
      ...DEFAULTS,
      ai: { ...DEFAULTS.ai, providers: [] },
      setupPending: true,
      connectionMode: { cli: true, mcp: false },
    };
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
  if (settings.baseUrlCompat !== undefined) merged.baseUrlCompat = settings.baseUrlCompat;
  if (settings.connectionMode !== undefined) merged.connectionMode = settings.connectionMode;
  if (settings.customAgents !== undefined) merged.customAgents = settings.customAgents;
  // Remove legacy customProviders (now merged into ai.providers array)
  delete merged.customProviders;
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

/* ── Skill install tracking ────────────────────────────────────── */

export interface SkillInstallRecord {
  agent: string;
  skill: string;
  path: string;
}

/**
 * Record that a skill was installed to a specific agent path.
 * Stored in config.json → installedSkillAgents[].
 * Idempotent — updates existing entry if agent+skill match.
 */
export function recordSkillInstall(agentKey: string, skillName: string, installPath: string): void {
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')); } catch { /* fresh */ }

  const list: SkillInstallRecord[] = Array.isArray(config.installedSkillAgents)
    ? (config.installedSkillAgents as SkillInstallRecord[])
    : [];

  const entry: SkillInstallRecord = { agent: agentKey, skill: skillName, path: installPath };
  const idx = list.findIndex(e => e.agent === agentKey && e.skill === skillName);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  config.installedSkillAgents = list;
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Effective AI config — unified interface for all providers.
 *  Resolves: saved config → env var → preset default, in that priority order.
 *  When `providerOverride` is given (a provider entry ID), resolves that provider's config. */
export function effectiveAiConfig(providerOverride?: string): {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
} {
  const s = readSettings();

  // Find the provider entry
  const targetId = providerOverride || s.ai.activeProvider;
  const entry = targetId ? findProvider(s.ai.providers, targetId) : undefined;

  if (entry) {
    // Resolve from the unified provider entry
    const preset = PROVIDER_PRESETS[entry.protocol];
    const apiKey = entry.apiKey
      || getApiKeyFromEnv(entry.protocol)
      || preset?.apiKeyFallback
      || '';
    const model = entry.model || preset?.defaultModel || '';
    const baseUrl = entry.baseUrl || preset?.fixedBaseUrl || '';
    return { provider: entry.protocol, apiKey, model, baseUrl };
  }

  // Fallback: no matching entry — try env var or default
  const envProvider = process.env.AI_PROVIDER;
  const protocol: ProviderId = (envProvider && isProviderId(envProvider)) ? envProvider : 'anthropic';
  const preset = PROVIDER_PRESETS[protocol] ?? PROVIDER_PRESETS.anthropic;

  return {
    provider: protocol,
    apiKey: getApiKeyFromEnv(protocol) || preset.apiKeyFallback || '',
    model: preset.defaultModel,
    baseUrl: preset.fixedBaseUrl || '',
  };
}

/** Effective MIND_ROOT — settings file can override, env var is fallback */
export function effectiveSopRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
}

/** Read the baseUrl → compat mode cache from config. Never throws. */
export function readBaseUrlCompat(): Record<string, 'streaming' | 'non-streaming'> {
  try {
    const s = readSettings();
    return s.baseUrlCompat ?? {};
  } catch {
    return {};
  }
}

/** Persist a baseUrl compatibility detection result. Thread-safe via merge-write. */
export function writeBaseUrlCompat(baseUrl: string, mode: 'streaming' | 'non-streaming'): void {
  const s = readSettings();
  const updated: Record<string, 'streaming' | 'non-streaming'> = {
    ...(s.baseUrlCompat ?? {}),
    [baseUrl]: mode,
  };
  writeSettings({ ...s, baseUrlCompat: updated });
}
