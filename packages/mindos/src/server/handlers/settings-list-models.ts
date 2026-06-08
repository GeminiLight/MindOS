import { json, type MindosServerResponse } from '../response.js';

export type SettingsListModelsPayload = {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
};

export type SettingsListModelsServices = {
  timeoutMs?: number;
  isProviderId?(value: string): boolean;
  isProviderEntryId?(value: string): boolean;
  readSettings?(): { ai?: { providers?: unknown[] } };
  findProvider?(providers: unknown[], id: string): { id?: string; protocol: string; apiKey?: string; baseUrl?: string } | undefined;
  effectiveAiConfig?(provider: string): { provider: string; apiKey?: string; baseUrl?: string };
  supportsListModels?(provider: string): boolean;
  getRegistryModels?(provider: string): string[] | Promise<string[]>;
  getProviderApiType?(provider: string): string;
  getDefaultBaseUrl?(provider: string): string;
  buildEndpointCandidates?(baseUrl: string, path: string, apiType: string): string[];
  fetch?(input: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'groq',
  'deepseek',
  'ollama',
  'lmstudio',
  'openrouter',
  'siliconflow',
]);

export async function handleSettingsListModelsPost(
  body: SettingsListModelsPayload | unknown,
  services: SettingsListModelsServices = {},
): Promise<MindosServerResponse<{ ok: true; models: string[] } | { ok: false; error: string }>> {
  try {
    const payload = body && typeof body === 'object' ? body as SettingsListModelsPayload : {};
    const provider = stringValue(payload.provider);
    const apiKey = stringValue(payload.apiKey);
    const baseUrl = stringValue(payload.baseUrl);

    if (provider && isProviderEntryId(provider, services)) {
      const settings = services.readSettings?.() ?? { ai: { providers: [] } };
      const providers = Array.isArray(settings.ai?.providers) ? settings.ai.providers : [];
      const entry = services.findProvider?.(providers, provider);
      if (!entry) return json({ ok: false, error: 'Provider not found' }, { status: 404 });
      const cfg = services.effectiveAiConfig?.(provider) ?? services.effectiveAiConfig?.(entry.protocol);
      return await listModels({
        provider: entry.protocol,
        apiKey: apiKey || entry.apiKey || cfg?.apiKey || '',
        baseUrl: baseUrl || entry.baseUrl || cfg?.baseUrl || '',
        services,
      });
    }

    if (!provider || !isProviderId(provider, services)) {
      return json({ ok: false, error: 'Invalid provider' }, { status: 400 });
    }

    if (services.supportsListModels?.(provider) === false) {
      return json({ ok: true, models: await getRegistryModels(provider, services) });
    }

    const cfg = services.effectiveAiConfig?.(provider) ?? { provider, apiKey: '', baseUrl: '' };
    const resolvedKey = apiKey || cfg.apiKey || '';
    const resolvedBaseUrl = baseUrl || cfg.baseUrl || '';

    if (!resolvedKey && !resolvedBaseUrl) {
      return json({ ok: false, error: 'No API key configured' });
    }

    return await listModels({ provider, apiKey: resolvedKey, baseUrl: resolvedBaseUrl, services });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Network error' });
  }
}

async function listModels(input: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  services: SettingsListModelsServices;
}): Promise<MindosServerResponse<{ ok: true; models: string[] } | { ok: false; error: string }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.services.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const models = await fetchModels(input.provider, input.apiKey, input.baseUrl, controller.signal, input.services);
    return json({ ok: true, models });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return json({ ok: false, error: 'Request timed out' });
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Network error' });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchModels(
  provider: string,
  apiKey: string,
  baseUrl: string,
  signal: AbortSignal,
  services: SettingsListModelsServices,
): Promise<string[]> {
  const apiType = services.getProviderApiType?.(provider) ?? 'openai-completions';
  const endpoints = resolveListModelsUrls(provider, baseUrl, apiType, services);
  return await fetchCompatModels(endpoints, apiKey, apiType, signal, services);
}

function resolveListModelsUrls(provider: string, baseUrl: string, apiType: string, services: SettingsListModelsServices): string[] {
  const build = services.buildEndpointCandidates ?? ((base: string, path: string) => [`${base.replace(/\/+$/, '')}${path}`]);
  if (baseUrl) return build(baseUrl, '/models', apiType);
  const defaultBaseUrl = services.getDefaultBaseUrl?.(provider) ?? '';
  if (defaultBaseUrl) return build(defaultBaseUrl, '/models', apiType);
  return ['https://api.openai.com/v1/models'];
}

async function fetchCompatModels(
  endpoints: string[],
  apiKey: string,
  apiType: string,
  signal: AbortSignal,
  services: SettingsListModelsServices,
): Promise<string[]> {
  const fetchImpl = services.fetch ?? defaultFetch;
  let lastError = 'No endpoint candidates';
  const attempted: string[] = [];

  for (const endpoint of endpoints) {
    attempted.push(endpoint);
    const headers: Record<string, string> = {};
    if (apiType === 'anthropic-messages') {
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetchImpl(endpoint, { headers, signal });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      lastError = `HTTP ${response.status} @ ${endpoint}: ${errorBody.slice(0, 200)}`;
      if (response.status === 400 || response.status === 404 || response.status === 405) continue;
      throw new Error(`Failed to list models: ${lastError}`);
    }

    const responseJson = await response.json();
    if (responseJson && typeof responseJson === 'object' && Array.isArray((responseJson as { data?: unknown[] }).data)) {
      return (responseJson as { data: Array<{ id?: unknown }> }).data
        .map((model) => model.id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id))
        .sort();
    }

    if (responseJson && typeof responseJson === 'object' && Array.isArray((responseJson as { models?: unknown[] }).models)) {
      return (responseJson as { models: unknown[] }).models
        .map((model) => typeof model === 'string' ? model : (model as { id?: unknown })?.id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id))
        .sort();
    }

    throw new Error(`Failed to list models: incompatible response shape from ${endpoint}; tried ${attempted.length} endpoint candidate(s)`);
  }

  throw new Error(`Failed to list models: ${lastError}; tried ${attempted.length} endpoint candidate(s)`);
}

async function getRegistryModels(provider: string, services: SettingsListModelsServices): Promise<string[]> {
  return (await services.getRegistryModels?.(provider) ?? []).filter(Boolean).sort();
}

async function defaultFetch(input: string, init: { headers: Record<string, string>; signal: AbortSignal }) {
  return fetch(input, init);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isProviderId(value: string, services: SettingsListModelsServices): boolean {
  return services.isProviderId ? services.isProviderId(value) : DEFAULT_PROVIDER_IDS.has(value);
}

function isProviderEntryId(value: string, services: SettingsListModelsServices): boolean {
  return services.isProviderEntryId ? services.isProviderEntryId(value) : value.startsWith('p_');
}
