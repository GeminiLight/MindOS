import { existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { json, type MindosServerResponse } from '../server/response.js';
import { expandSetupPathHome, validateMindRootPath, type PathValidationResult } from '../server/handlers/setup-path.js';
import { handleInitPost } from '../server/handlers/init.js';

export type MindosSetupProvider = {
  id: string;
  name: string;
  protocol: string;
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type MindosSetupAiConfig = {
  activeProvider: string;
  providers: MindosSetupProvider[];
};

export type MindosSetupGuideState = {
  active: boolean;
  dismissed: boolean;
  template: 'en' | 'zh' | 'empty';
  step1Done: boolean;
  askedAI: boolean;
  agentPromptDone: boolean;
  nextStepIndex: number;
  walkthroughStep?: number;
  walkthroughDismissed?: boolean;
};

export const INITIAL_SPACE_IDS = ['life', 'social', 'learning', 'content', 'product', 'research'] as const;

export type MindosSetupInitialSpaceId = typeof INITIAL_SPACE_IDS[number];
export type MindosSetupInitialSpaceLocale = 'en' | 'zh';

export type MindosSetupInitialSpaceInstallResult = {
  id: MindosSetupInitialSpaceId;
  locale: MindosSetupInitialSpaceLocale;
  copied: string[];
  skipped: string[];
};

export type MindosSetupSettings = {
  ai: MindosSetupAiConfig;
  mindRoot: string;
  port?: number;
  mcpPort?: number;
  authToken?: string;
  webPassword?: string;
  webSessionSecret?: string;
  startMode?: 'dev' | 'start' | 'daemon';
  setupPending?: boolean;
  setupPort?: number;
  disabledSkills?: string[];
  guideState?: MindosSetupGuideState;
  connectionMode?: { cli: boolean; mcp: boolean };
  [key: string]: unknown;
};

export type MindosSetupProviderPreset = {
  name?: string;
  defaultModel?: string;
};

export type MindosSetupServices = {
  readSettings(): MindosSetupSettings;
  writeSettings(settings: MindosSetupSettings): void;
  homeDir?: () => string;
  platform?: () => NodeJS.Platform | string;
  pathSep?: () => string;
  env?: () => Record<string, string | undefined>;
  existsSync?: (target: string) => boolean;
  mkdirSync?: (target: string) => void;
  applyTemplate?: (template: string, mindRoot: string) => { ok: true } | { error: string; status?: number };
  applyInitialSpaces?: (
    initialSpaces: MindosSetupInitialSpaceId[],
    mindRoot: string,
    locale: MindosSetupInitialSpaceLocale,
  ) => { ok: true; installed: MindosSetupInitialSpaceInstallResult[] } | { error: string; status?: number };
  expandPathHome?: (input: string) => string;
  validateMindRootPath?: (absPath: string) => PathValidationResult;
  isProviderId?: (value: string) => boolean;
  generateProviderId?: () => string;
  providerPresets?: Record<string, MindosSetupProviderPreset | undefined>;
};

export type MindosSetupStatePayload = {
  mindRoot: string;
  homeDir: string;
  platform: string;
  port: number;
  mcpPort: number;
  authToken: string;
  webPassword: string;
  activeProvider: string;
  providerConfigs: Array<Omit<MindosSetupProvider, 'apiKey'> & { apiKeyMask: string }>;
  guideState: MindosSetupGuideState | null;
};

export type MindosSetupApplyPayload = {
  ok: true;
  portChanged: boolean;
  needsRestart: boolean;
  newPort: number;
  installedInitialSpaces?: MindosSetupInitialSpaceInstallResult[];
};

const DEFAULT_PROVIDER_PRESETS: Record<string, MindosSetupProviderPreset> = {
  anthropic: { name: 'Anthropic', defaultModel: 'claude-sonnet-4-6' },
  openai: { name: 'OpenAI', defaultModel: 'gpt-5.4' },
  google: { name: 'Google Gemini', defaultModel: 'gemini-2.5-flash' },
  groq: { name: 'Groq', defaultModel: 'llama-3.3-70b-versatile' },
  xai: { name: 'xAI (Grok)', defaultModel: 'grok-3' },
  openrouter: { name: 'OpenRouter', defaultModel: 'anthropic/claude-sonnet-4' },
  mistral: { name: 'Mistral', defaultModel: 'mistral-large-latest' },
  deepseek: { name: 'DeepSeek', defaultModel: 'deepseek-chat' },
  zai: { name: 'ZhipuAI (GLM)', defaultModel: 'glm-4-plus' },
  'zai-cn': { name: 'ZhipuAI (GLM China)', defaultModel: 'glm-4-plus' },
  'kimi-coding': { name: 'Kimi Coding', defaultModel: 'kimi-k2-thinking' },
  ollama: { name: 'Ollama', defaultModel: 'llama3.2' },
  'lm-studio': { name: 'LM Studio', defaultModel: '' },
  vllm: { name: 'vLLM', defaultModel: '' },
};

function resolveWebSessionSecret(current: MindosSetupSettings, webPassword: string): string | undefined {
  if (!webPassword) return current.webSessionSecret;
  if (typeof current.webSessionSecret === 'string' && current.webSessionSecret.trim()) {
    return current.webSessionSecret;
  }
  if (typeof current.webPassword === 'string' && current.webPassword) {
    return current.webPassword;
  }
  return randomBytes(32).toString('base64url');
}

export function buildMindosSetupState(
  services: MindosSetupServices,
): MindosServerResponse<MindosSetupStatePayload> {
  const settings = normalizeSetupSettings(services.readSettings());
  const home = getHomeDir(services);
  const defaultMindRoot = settings.mindRoot || toHomeRelativePath(resolveDefaultMindRoot(services), home, services);
  const providerConfigs = settings.ai.providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiKeyMask: maskSetupApiKey(provider.apiKey),
  }));

  return json({
    mindRoot: defaultMindRoot,
    homeDir: home,
    platform: services.platform?.() ?? platform(),
    port: settings.port ?? 3456,
    mcpPort: settings.mcpPort ?? 8781,
    authToken: settings.authToken ?? '',
    webPassword: settings.webPassword ?? '',
    activeProvider: settings.ai.activeProvider,
    providerConfigs,
    guideState: settings.guideState ?? null,
  });
}

export function applyMindosSetupConfig(
  body: unknown,
  services: MindosSetupServices,
): MindosServerResponse<MindosSetupApplyPayload | { error: string; errorZh?: string; unsafePath?: true }> {
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const mindRoot = typeof payload.mindRoot === 'string' ? payload.mindRoot : '';
  if (!mindRoot) {
    return json({ error: 'mindRoot is required' }, { status: 400 });
  }

  const resolvedRoot = expandPathHome(mindRoot.trim(), services);
  const pathValidation = validateRootPath(resolvedRoot, services);
  if (!pathValidation.safe) {
    return json({
      error: pathValidation.reason ?? 'Unsafe path',
      errorZh: pathValidation.reasonZh,
      unsafePath: true,
    }, { status: 400 });
  }

  const webPort = typeof payload.port === 'number' ? payload.port : 3456;
  const mcpPort = typeof payload.mcpPort === 'number' ? payload.mcpPort : 8781;
  if (webPort < 1024 || webPort > 65535) {
    return json({ error: `Invalid web port: ${webPort}` }, { status: 400 });
  }
  if (mcpPort < 1024 || mcpPort > 65535) {
    return json({ error: `Invalid MCP port: ${mcpPort}` }, { status: 400 });
  }

  const template = typeof payload.template === 'string' ? payload.template : undefined;
  const selectedInitialSpaces = normalizeInitialSpaceSelection(payload.initialSpaces, payload.spaceKits);
  if ('error' in selectedInitialSpaces) {
    return json({ error: selectedInitialSpaces.error }, { status: 400 });
  }
  const initialSpaceLocale = normalizeInitialSpaceLocale(payload.initialSpaceLocale ?? payload.spaceKitLocale, template);
  const exists = (services.existsSync ?? existsSync)(resolvedRoot);
  if (template) {
    const result = applyTemplate(template, resolvedRoot, services);
    if ('error' in result) {
      return json({ error: result.error }, { status: result.status ?? 500 });
    }
  } else if (!exists) {
    (services.mkdirSync ?? ((target: string) => mkdirSync(target, { recursive: true })))(resolvedRoot);
  }

  let installedInitialSpaces: MindosSetupInitialSpaceInstallResult[] | undefined;
  if (selectedInitialSpaces.ids.length > 0) {
    const result = applyInitialSpaces(selectedInitialSpaces.ids, resolvedRoot, initialSpaceLocale, services);
    if ('error' in result) {
      return json({ error: result.error }, { status: result.status ?? 500 });
    }
    installedInitialSpaces = result.installed;
  }

  const current = normalizeSetupSettings(services.readSettings());
  const currentPort = current.port ?? 3456;
  const authToken = typeof payload.authToken === 'string' ? payload.authToken : undefined;
  const webPassword = typeof payload.webPassword === 'string' ? payload.webPassword : undefined;
  const resolvedAuthToken = authToken ?? current.authToken ?? '';
  const resolvedWebPassword = webPassword ?? '';
  const isFirstTime = current.setupPending === true || !current.mindRoot;
  const needsRestart = isFirstTime || (
    webPort !== (current.port ?? 3456) ||
    mcpPort !== (current.mcpPort ?? 8781) ||
    resolvedRoot !== (current.mindRoot || '') ||
    resolvedAuthToken !== (current.authToken ?? '') ||
    resolvedWebPassword !== (current.webPassword ?? '')
  );

  const config: MindosSetupSettings = {
    ...current,
    ai: mergeSetupAiConfig(current.ai, payload.ai, services),
    mindRoot: resolvedRoot,
    port: webPort,
    mcpPort,
    authToken: authToken ?? current.authToken,
    webPassword: webPassword ?? '',
    webSessionSecret: resolveWebSessionSecret(current, resolvedWebPassword),
    startMode: current.startMode,
    setupPending: false,
    setupPort: undefined,
    disabledSkills: template === 'zh' ? ['mindos'] : ['mindos-zh'],
    guideState: current.guideState ?? createGuideState(template),
    connectionMode: resolveConnectionMode(current.connectionMode, payload.connectionMode),
  };

  services.writeSettings(config);
  return json({
    ok: true,
    portChanged: webPort !== currentPort,
    needsRestart,
    newPort: webPort,
    installedInitialSpaces,
  });
}

export function patchMindosSetupGuideState(
  body: unknown,
  services: MindosSetupServices,
): MindosServerResponse<{ ok: true; guideState: MindosSetupGuideState } | { error: string }> {
  const payload = body && typeof body === 'object' ? body as { guideState?: unknown } : {};
  const patch = payload.guideState;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return json({ error: 'guideState object required' }, { status: 400 });
  }

  const current = normalizeSetupSettings(services.readSettings());
  const existing = current.guideState ?? {
    active: false,
    dismissed: false,
    template: 'en' as const,
    step1Done: false,
    askedAI: false,
    agentPromptDone: false,
    nextStepIndex: 0,
  };
  const patchRecord = patch as Record<string, unknown>;
  const updated: MindosSetupGuideState = { ...existing };
  if (typeof patchRecord.dismissed === 'boolean') updated.dismissed = patchRecord.dismissed;
  if (typeof patchRecord.step1Done === 'boolean') updated.step1Done = patchRecord.step1Done;
  if (typeof patchRecord.askedAI === 'boolean') updated.askedAI = patchRecord.askedAI;
  if (typeof patchRecord.agentPromptDone === 'boolean') updated.agentPromptDone = patchRecord.agentPromptDone;
  if (typeof patchRecord.nextStepIndex === 'number' && patchRecord.nextStepIndex >= 0) updated.nextStepIndex = patchRecord.nextStepIndex;
  if (typeof patchRecord.active === 'boolean') updated.active = patchRecord.active;
  if (typeof patchRecord.walkthroughStep === 'number' && patchRecord.walkthroughStep >= 0) updated.walkthroughStep = patchRecord.walkthroughStep;
  if (typeof patchRecord.walkthroughDismissed === 'boolean') updated.walkthroughDismissed = patchRecord.walkthroughDismissed;

  services.writeSettings({ ...current, guideState: updated });
  return json({ ok: true, guideState: updated });
}

export function maskSetupApiKey(key: string): string {
  if (!key || key.length < 6) return key ? '***' : '';
  return `${key.slice(0, 6)}***`;
}

function normalizeSetupSettings(settings: MindosSetupSettings): MindosSetupSettings {
  return {
    ...settings,
    ai: {
      activeProvider: settings.ai?.activeProvider ?? '',
      providers: Array.isArray(settings.ai?.providers) ? settings.ai.providers : [],
    },
    mindRoot: settings.mindRoot ?? '',
  };
}

function expandPathHome(input: string, services: MindosSetupServices): string {
  return services.expandPathHome?.(input) ?? expandSetupPathHome(input, { homeDir: getHomeDir(services) });
}

function validateRootPath(input: string, services: MindosSetupServices): PathValidationResult {
  return services.validateMindRootPath?.(input) ?? validateMindRootPath(input, { homeDir: getHomeDir(services) });
}

function getHomeDir(services: MindosSetupServices): string {
  return services.homeDir?.() ?? homedir();
}

export function resolveDefaultMindRoot(services: MindosSetupServices): string {
  const home = getHomeDir(services);
  const sep = services.pathSep?.() ?? path.sep;
  const currentPlatform = services.platform?.() ?? platform();
  const env = services.env?.() ?? process.env;
  const docsDir = resolveDocumentsDir(home, sep, currentPlatform, env);
  if (docsDir && shouldUseDocumentsDir(docsDir, currentPlatform, services)) {
    return [docsDir, 'MindOS', 'mind'].join(sep);
  }
  return [home, 'MindOS', 'mind'].join(sep);
}

function toHomeRelativePath(target: string, home: string, services: MindosSetupServices): string {
  if (!target || !home) return target;
  const sep = services.pathSep?.() ?? path.sep;
  const normalizedHome = stripTrailingSeparators(home, sep);
  const normalizedTarget = stripTrailingSeparators(target, sep);
  const lowerHome = normalizedHome.toLowerCase();
  const lowerTarget = normalizedTarget.toLowerCase();
  if (lowerTarget === lowerHome) return '~';
  const homeWithSep = `${normalizedHome}${sep}`;
  if (lowerTarget.startsWith(homeWithSep.toLowerCase())) {
    return `~${sep}${normalizedTarget.slice(homeWithSep.length)}`;
  }
  return target;
}

function stripTrailingSeparators(value: string, sep: string): string {
  let current = value;
  while (current.length > 1 && (current.endsWith('/') || current.endsWith('\\') || current.endsWith(sep))) {
    current = current.slice(0, -1);
  }
  return current;
}

function resolveDocumentsDir(
  home: string,
  sep: string,
  currentPlatform: NodeJS.Platform | string,
  env: Record<string, string | undefined>,
): string {
  if (currentPlatform === 'win32') return [home, 'Documents'].join(sep);
  if (currentPlatform === 'linux' && env.XDG_DOCUMENTS_DIR?.trim()) {
    return expandEnvHome(env.XDG_DOCUMENTS_DIR.trim(), home);
  }
  return [home, 'Documents'].join(sep);
}

function expandEnvHome(value: string, home: string): string {
  if (value === '$HOME') return home;
  if (value.startsWith('$HOME/')) return path.join(home, value.slice('$HOME/'.length));
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(home, value.slice(2));
  return value;
}

function shouldUseDocumentsDir(
  docsDir: string,
  currentPlatform: NodeJS.Platform | string,
  services: MindosSetupServices,
): boolean {
  if (currentPlatform === 'darwin' || currentPlatform === 'win32') return true;
  const exists = services.existsSync ?? existsSync;
  return exists(docsDir);
}

function applyTemplate(template: string, mindRoot: string, services: MindosSetupServices): { ok: true } | { error: string; status?: number } {
  if (services.applyTemplate) return services.applyTemplate(template, mindRoot);
  const response = handleInitPost({ template }, { mindRoot });
  if (response.status >= 400) {
    return { error: (response.body as { error?: string } | undefined)?.error ?? `Failed to apply template: ${template}`, status: response.status };
  }
  return { ok: true };
}

function applyInitialSpaces(
  initialSpaces: MindosSetupInitialSpaceId[],
  mindRoot: string,
  locale: MindosSetupInitialSpaceLocale,
  services: MindosSetupServices,
): { ok: true; installed: MindosSetupInitialSpaceInstallResult[] } | { error: string; status?: number } {
  if (!services.applyInitialSpaces) {
    return { error: 'Initial Space installer is not available in this runtime', status: 501 };
  }
  return services.applyInitialSpaces(initialSpaces, mindRoot, locale);
}

function createGuideState(template: string | undefined): MindosSetupGuideState {
  return {
    active: true,
    dismissed: false,
    template: template === 'zh' ? 'zh' : template === 'empty' ? 'empty' : 'en',
    step1Done: false,
    askedAI: false,
    agentPromptDone: false,
    nextStepIndex: 0,
    walkthroughStep: 0,
    walkthroughDismissed: false,
  };
}

function resolveConnectionMode(current: MindosSetupSettings['connectionMode'], input: unknown): { cli: boolean; mcp: boolean } {
  const fallback = current ?? { cli: true, mcp: false };
  if (input && typeof input === 'object') {
    const record = input as { cli?: unknown; mcp?: unknown };
    if (typeof record.cli === 'boolean' && typeof record.mcp === 'boolean') {
      return { cli: record.cli, mcp: record.mcp };
    }
  }
  return fallback;
}

function normalizeInitialSpaceSelection(
  input: unknown,
  legacyInput: unknown,
): { ids: MindosSetupInitialSpaceId[] } | { error: string } {
  const source = input === undefined ? legacyInput : input;
  const fieldName = input === undefined && legacyInput !== undefined ? 'spaceKits' : 'initialSpaces';
  if (source === undefined) return { ids: [] };
  if (!Array.isArray(source)) return { error: `${fieldName} must be an array` };
  const seen = new Set<MindosSetupInitialSpaceId>();
  for (const item of source) {
    if (!isInitialSpaceId(item)) return { error: `Invalid initial space: ${String(item)}` };
    seen.add(item);
  }
  return { ids: [...seen] };
}

function normalizeInitialSpaceLocale(input: unknown, template: string | undefined): MindosSetupInitialSpaceLocale {
  if (input === 'zh' || input === 'en') return input;
  return template === 'zh' ? 'zh' : 'en';
}

function isInitialSpaceId(value: unknown): value is MindosSetupInitialSpaceId {
  return typeof value === 'string' && (INITIAL_SPACE_IDS as readonly string[]).includes(value);
}

function mergeSetupAiConfig(
  current: MindosSetupAiConfig,
  input: unknown,
  services: MindosSetupServices,
): MindosSetupAiConfig {
  if (!input || typeof input !== 'object') return current;
  const ai = input as Record<string, unknown>;
  const mergedProviders = [...current.providers];
  const incomingProviders = ai.providers;

  if (Array.isArray(incomingProviders)) {
    for (const incoming of incomingProviders) {
      if (!incoming || typeof incoming !== 'object') continue;
      const record = incoming as Record<string, unknown>;
      if (typeof record.id !== 'string' || !isProviderId(record.protocol, services)) continue;
      const existingIndex = mergedProviders.findIndex((provider) => provider.id === record.id);
      const existing = existingIndex >= 0 ? mergedProviders[existingIndex] : undefined;
      const provider = mergeProviderEntry(record.id, record.protocol, record, existing, services);
      if (existingIndex >= 0) mergedProviders[existingIndex] = provider;
      else mergedProviders.push(provider);
    }
    return {
      activeProvider: typeof ai.activeProvider === 'string' ? ai.activeProvider : current.activeProvider,
      providers: mergedProviders,
    };
  }

  if (incomingProviders && typeof incomingProviders === 'object') {
    for (const [protocol, rawConfig] of Object.entries(incomingProviders as Record<string, unknown>)) {
      if (!isProviderId(protocol, services) || !rawConfig || typeof rawConfig !== 'object') continue;
      const existingIndex = mergedProviders.findIndex((provider) => provider.protocol === protocol);
      const existing = existingIndex >= 0 ? mergedProviders[existingIndex] : undefined;
      const id = existing?.id ?? services.generateProviderId?.() ?? `p_${Math.random().toString(36).slice(2, 10)}`;
      const provider = mergeProviderEntry(id, protocol, rawConfig as Record<string, unknown>, existing, services);
      if (existingIndex >= 0) mergedProviders[existingIndex] = provider;
      else mergedProviders.push(provider);
    }

    let activeProvider = current.activeProvider;
    if (typeof ai.provider === 'string' && isProviderId(ai.provider, services)) {
      activeProvider = mergedProviders.find((provider) => provider.protocol === ai.provider)?.id ?? activeProvider;
    }
    return { activeProvider, providers: mergedProviders };
  }

  return current;
}

function mergeProviderEntry(
  id: string,
  protocol: unknown,
  incoming: Record<string, unknown>,
  existing: MindosSetupProvider | undefined,
  services: MindosSetupServices,
): MindosSetupProvider {
  const protocolId = String(protocol);
  const preset = services.providerPresets?.[protocolId] ?? DEFAULT_PROVIDER_PRESETS[protocolId];
  return {
    id,
    name: typeof incoming.name === 'string' && incoming.name ? incoming.name : existing?.name ?? preset?.name ?? protocolId,
    protocol: protocolId,
    apiKey: typeof incoming.apiKey === 'string' && incoming.apiKey ? incoming.apiKey : existing?.apiKey ?? '',
    model: typeof incoming.model === 'string' && incoming.model ? incoming.model : existing?.model ?? preset?.defaultModel ?? '',
    baseUrl: typeof incoming.baseUrl === 'string' ? incoming.baseUrl : existing?.baseUrl ?? '',
  };
}

function isProviderId(value: unknown, services: MindosSetupServices): value is string {
  if (typeof value !== 'string') return false;
  return services.isProviderId?.(value) ?? Object.prototype.hasOwnProperty.call(DEFAULT_PROVIDER_PRESETS, value);
}
