import { randomBytes } from 'node:crypto';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type MindosSettingsAi = {
  activeProvider?: string;
  providers?: unknown;
};

export type MindosEmbeddingSettings = {
  enabled?: boolean;
  provider?: 'local' | 'api' | string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

export type MindosConnectionMode = {
  cli: boolean;
  mcp: boolean;
};

export type MindosServerSettings = {
  ai: MindosSettingsAi;
  embedding?: MindosEmbeddingSettings;
  mindRoot?: string;
  webPassword?: string;
  authToken?: string;
  allowNetworkAccess?: boolean;
  port?: number;
  mcpPort?: number;
  agent?: unknown;
  skillPaths?: Record<string, unknown>;
  startMode?: string;
  connectionMode?: MindosConnectionMode;
  baseUrlCompat?: Record<string, unknown>;
};

export type MindosWebSearchConfig = {
  provider?: string;
  exaApiKey?: string;
  perplexityApiKey?: string;
  geminiApiKey?: string;
};

export type MindosProviderEnvServices = {
  ids: string[];
  getApiKeyEnvVar(id: string): string | undefined;
  getApiKeyFromEnv(id: string): string | undefined;
};

export type MindosSettingsServices = {
  env?: Record<string, string | undefined>;
  readSettings(): MindosServerSettings;
  writeSettings(settings: MindosServerSettings): void;
  readWebSearchConfig(): MindosWebSearchConfig;
  writeWebSearchConfig(config: MindosWebSearchConfig): void;
  parseProviders(providers: unknown): unknown;
  getEmbeddingStatus(): unknown;
  invalidateCache(): void;
  providerEnv: MindosProviderEnvServices;
};

export type MindosSettingsResetTokenSettings = {
  authToken?: string;
  [key: string]: unknown;
};

export type MindosSettingsResetTokenServices = {
  readSettings(): MindosSettingsResetTokenSettings;
  writeSettings(settings: MindosSettingsResetTokenSettings): void;
};

export type MindosSettingsPayload = {
  ai: MindosSettingsAi;
  embedding: MindosEmbeddingSettings;
  embeddingStatus: unknown;
  webSearch: {
    provider: string;
    exaApiKey: string;
    perplexityApiKey: string;
    geminiApiKey: string;
  };
  mindRoot?: string;
  webPassword: string;
  authToken: string;
  allowNetworkAccess: boolean;
  port: number;
  mcpPort: number;
  agent: unknown;
  skillPaths: Record<string, unknown>;
  envOverrides: Record<string, boolean>;
  envValues: Record<string, string>;
};

function maskToken(token: string | undefined): string {
  if (!token) return '';
  const parts = token.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts.slice(1, -1).map(() => '••••').join('-')}-${parts[parts.length - 1]}`;
  }
  return token.length > 8 ? `${token.slice(0, 4)}••••••••${token.slice(-4)}` : '***set***';
}

function maskWebSearchKey(value: string | undefined) {
  return value ? '••••••' : '';
}

function defaultEmbedding(): MindosEmbeddingSettings {
  return { enabled: false, provider: 'local', baseUrl: '', apiKey: '', model: '' };
}

function resolveEmbedding(input: unknown): MindosEmbeddingSettings {
  if (!input || typeof input !== 'object') return defaultEmbedding();
  const source = input as Record<string, unknown>;
  const provider = source.provider === 'local' || source.provider === 'api' ? source.provider : 'api';
  return {
    enabled: source.enabled === true,
    provider,
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : '',
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
    model: typeof source.model === 'string' ? source.model : '',
  };
}

function resolveConnectionMode(current: MindosConnectionMode | undefined, incoming: unknown): MindosConnectionMode {
  const fallback = current ?? { cli: true, mcp: false };
  if (!incoming || typeof incoming !== 'object') return fallback;
  const mode = incoming as Record<string, unknown>;
  if (typeof mode.cli !== 'boolean' || typeof mode.mcp !== 'boolean') return fallback;
  return { cli: mode.cli, mcp: mode.mcp };
}

function resolveWebSearchPatch(incoming: unknown, current: MindosWebSearchConfig): MindosWebSearchConfig | undefined {
  if (!incoming || typeof incoming !== 'object') return undefined;
  const ws = incoming as Record<string, unknown>;
  const patch: MindosWebSearchConfig = {};
  if (typeof ws.provider === 'string') patch.provider = ws.provider;
  if (typeof ws.exaApiKey === 'string') patch.exaApiKey = ws.exaApiKey.includes('••') ? current.exaApiKey : ws.exaApiKey;
  if (typeof ws.perplexityApiKey === 'string') patch.perplexityApiKey = ws.perplexityApiKey.includes('••') ? current.perplexityApiKey : ws.perplexityApiKey;
  if (typeof ws.geminiApiKey === 'string') patch.geminiApiKey = ws.geminiApiKey.includes('••') ? current.geminiApiKey : ws.geminiApiKey;
  return { ...current, ...patch };
}

export function handleSettingsGet(services: MindosSettingsServices): MindosServerResponse<MindosSettingsPayload | { error: string }> {
  try {
    const settings = services.readSettings();
    const ai = settings.ai ?? {};
    const env = services.env ?? {};
    const envOverrides: Record<string, boolean> = {
      AI_PROVIDER: !!env.AI_PROVIDER,
      MIND_ROOT: !!env.MIND_ROOT,
    };
    const envValues: Record<string, string> = {
      AI_PROVIDER: env.AI_PROVIDER || '',
      MIND_ROOT: env.MIND_ROOT || '',
    };

    for (const id of services.providerEnv.ids) {
      const envKey = services.providerEnv.getApiKeyEnvVar(id);
      if (!envKey) continue;
      const value = services.providerEnv.getApiKeyFromEnv(id);
      envOverrides[envKey] = !!value;
      envValues[envKey] = value ? '***set***' : '';
    }

    const webSearch = services.readWebSearchConfig();
    return json({
      ai: {
        activeProvider: ai.activeProvider ?? '',
        providers: ai.providers ?? [],
      },
      embedding: settings.embedding ?? defaultEmbedding(),
      embeddingStatus: services.getEmbeddingStatus(),
      webSearch: {
        provider: webSearch.provider ?? 'auto',
        exaApiKey: maskWebSearchKey(webSearch.exaApiKey),
        perplexityApiKey: maskWebSearchKey(webSearch.perplexityApiKey),
        geminiApiKey: maskWebSearchKey(webSearch.geminiApiKey),
      },
      mindRoot: settings.mindRoot,
      webPassword: settings.webPassword ?? '',
      authToken: maskToken(settings.authToken),
      allowNetworkAccess: settings.allowNetworkAccess === true,
      port: Number(env.MINDOS_WEB_PORT) || settings.port || 3456,
      mcpPort: settings.mcpPort ?? 8781,
      agent: settings.agent ?? {},
      skillPaths: settings.skillPaths ?? {},
      envOverrides,
      envValues,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleSettingsPost(
  body: Partial<MindosServerSettings> & { webSearch?: unknown },
  services: MindosSettingsServices,
): MindosServerResponse<{ ok: true } | { error: string }> {
  try {
    const current = services.readSettings();
    const resolvedAi = { ...(current.ai ?? {}) };
    if (body.ai) {
      if (body.ai.activeProvider !== undefined) resolvedAi.activeProvider = body.ai.activeProvider;
      if (body.ai.providers !== undefined) resolvedAi.providers = services.parseProviders(body.ai.providers);
    }

    const currentWebSearch = services.readWebSearchConfig();
    const nextWebSearch = resolveWebSearchPatch(body.webSearch, currentWebSearch);
    if (nextWebSearch) services.writeWebSearchConfig(nextWebSearch);

    const resolvedAuthToken = body.authToken === '' ? '' : current.authToken;
    const next: MindosServerSettings = {
      ai: resolvedAi,
      embedding: body.embedding && typeof body.embedding === 'object' ? resolveEmbedding(body.embedding) : current.embedding,
      mindRoot: body.mindRoot ?? current.mindRoot,
      agent: body.agent ?? current.agent,
      skillPaths: body.skillPaths ?? current.skillPaths,
      webPassword: body.webPassword ?? current.webPassword,
      authToken: resolvedAuthToken,
      allowNetworkAccess: typeof body.allowNetworkAccess === 'boolean'
        ? body.allowNetworkAccess
        : current.allowNetworkAccess === true,
      port: typeof body.port === 'number' ? body.port : current.port,
      mcpPort: typeof body.mcpPort === 'number' ? body.mcpPort : current.mcpPort,
      startMode: body.startMode ?? current.startMode,
      connectionMode: resolveConnectionMode(current.connectionMode, body.connectionMode),
      baseUrlCompat: current.baseUrlCompat,
    };

    services.writeSettings(next);
    if (JSON.stringify(next.ai) !== JSON.stringify(current.ai)) {
      const latest = services.readSettings();
      if (latest.baseUrlCompat && Object.keys(latest.baseUrlCompat).length > 0) {
        services.writeSettings({ ...latest, baseUrlCompat: {} });
      }
    }
    if (next.mindRoot !== current.mindRoot) services.invalidateCache();

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleSettingsResetTokenPost(
  services: MindosSettingsResetTokenServices,
): MindosServerResponse<{ ok: true; token: string } | { error: string }> {
  try {
    const current = services.readSettings();
    const token = generateAuthToken();
    services.writeSettings({ ...current, authToken: token });
    return json({ ok: true, token });
  } catch (error) {
    return errorResponse(error);
  }
}

function generateAuthToken(): string {
  const hex = randomBytes(12).toString('hex');
  return (hex.match(/.{4}/g) ?? [hex]).join('-');
}
