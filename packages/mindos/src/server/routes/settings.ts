import { handleEmbeddingGet, handleEmbeddingPost } from '../handlers/embedding.js';
import {
  handleSettingsGet,
  handleSettingsPost,
  handleSettingsResetTokenPost,
  type MindosServerSettings,
  type MindosSettingsServices,
  type MindosWebSearchConfig,
} from '../handlers/settings.js';
import { handleSettingsListModelsPost } from '../handlers/settings-list-models.js';
import { handleSettingsTestKeyPost } from '../handlers/settings-test-key.js';
import {
  MINDOS_PROVIDER_PRESETS,
  buildMindosEndpointCandidates,
  findMindosProvider,
  getMindosApiKeyFromEnv,
  isMindosProviderEntryId,
  isMindosProviderId,
  parseMindosProviders,
  resolveMindosProviderConfig,
} from '../provider-settings.js';
import { defineRoutes } from '../route-table.js';
import { readMindosIgnoreFile, writeMindosIgnoreFile, type MindosRuntimeSettings } from '../runtime.js';
import type { MindosHttpServices } from '../services.js';

export const settingsRoutes = defineRoutes([
  { id: 'embedding', method: 'GET', path: '/api/embedding', auth: 'required',
    handler: () => handleEmbeddingGet() },
  { id: 'embedding.action', method: 'POST', path: '/api/embedding', auth: 'required',
    handler: async ({ readJsonBody }) => handleEmbeddingPost(await readJsonBody()) },
  { id: 'settings', method: 'GET', path: '/api/settings', auth: 'required',
    handler: ({ services }) => handleSettingsGet(createHttpSettingsServices(services)) },
  { id: 'settings.update', method: 'POST', path: '/api/settings', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleSettingsPost(
      await readJsonBody() as Partial<MindosServerSettings> & { webSearch?: unknown },
      createHttpSettingsServices(services),
    ) },
  { id: 'settings.reset-token', method: 'POST', path: '/api/settings/reset-token', auth: 'required',
    handler: ({ services }) => handleSettingsResetTokenPost({
      readSettings: services.readSettings,
      writeSettings: (settings) => services.writeSettings(settings),
    }) },
  { id: 'settings.test-key', method: 'POST', path: '/api/settings/test-key', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleSettingsTestKeyPost(
      await readJsonBody(),
      createHttpSettingsTestKeyServices(services),
    ) },
  { id: 'settings.list-models', method: 'POST', path: '/api/settings/list-models', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleSettingsListModelsPost(
      await readJsonBody(),
      createHttpSettingsListModelsServices(services),
    ) },
]);

function createHttpSettingsServices(services: MindosHttpServices): MindosSettingsServices {
  return {
    env: process.env,
    readSettings: () => normalizeSettingsForHttp(services.readSettings()),
    writeSettings: (settings) => {
      const current = services.readSettings();
      services.writeSettings({ ...current, ...(settings as MindosRuntimeSettings) });
    },
    readWebSearchConfig: () => {
      const raw = services.readSettings().webSearch;
      return raw && typeof raw === 'object' ? raw as MindosWebSearchConfig : {};
    },
    writeWebSearchConfig: (config) => {
      const current = services.readSettings();
      services.writeSettings({ ...current, webSearch: config });
    },
    parseProviders: parseMindosProviders,
    getEmbeddingStatus: () => ({ enabled: false, ready: false, building: false, docCount: 0 }),
    invalidateCache: () => {},
    readSearchIgnoreFile: (mindRoot) => mindRoot ? readMindosIgnoreFile(mindRoot) : [],
    writeSearchIgnoreFile: (mindRoot, ignoredPaths) => {
      writeMindosIgnoreFile(mindRoot, ignoredPaths);
    },
    providerEnv: {
      ids: Object.keys(MINDOS_PROVIDER_PRESETS),
      getApiKeyEnvVar: (id) => MINDOS_PROVIDER_PRESETS[id]?.envKeys[0],
      getApiKeyFromEnv: (id) => getMindosApiKeyFromEnv(id),
    },
  };
}

export function normalizeSettingsForHttp(settings: MindosRuntimeSettings) {
  const ai = settings.ai && typeof settings.ai === 'object'
    ? settings.ai as { activeProvider?: string; providers?: unknown }
    : {};
  const providers = parseMindosProviders(ai.providers, ai.activeProvider);
  return {
    ...settings,
    ai: {
      activeProvider: normalizeHttpActiveProvider(ai.activeProvider, providers),
      providers,
    },
  };
}

function normalizeHttpActiveProvider(activeProvider: unknown, providers: Array<{ id: string; protocol: string }>): string {
  const active = typeof activeProvider === 'string' ? activeProvider : '';
  if (active && isMindosProviderEntryId(active) && providers.some((provider) => provider.id === active)) {
    return active;
  }
  if (active && isMindosProviderId(active)) {
    return providers.find((provider) => provider.protocol === active)?.id ?? providers[0]?.id ?? '';
  }
  return providers[0]?.id ?? '';
}

function createHttpSettingsTestKeyServices(services: MindosHttpServices) {
  return {
    isProviderId: isMindosProviderId,
    isProviderEntryId: isMindosProviderEntryId,
    readSettings: () => normalizeSettingsForHttp(services.readSettings()),
    findProvider: findMindosProvider,
    effectiveAiConfig: (provider: string) => resolveMindosProviderConfig(
      normalizeSettingsForHttp(services.readSettings()),
      provider,
      process.env,
    ),
    testModel: testProviderConnectivity,
    clearCompatCacheForBaseUrl: () => undefined,
  };
}

function createHttpSettingsListModelsServices(services: MindosHttpServices) {
  return {
    isProviderId: isMindosProviderId,
    isProviderEntryId: isMindosProviderEntryId,
    readSettings: () => normalizeSettingsForHttp(services.readSettings()),
    findProvider: findMindosProvider,
    effectiveAiConfig: (provider: string) => resolveMindosProviderConfig(
      normalizeSettingsForHttp(services.readSettings()),
      provider,
      process.env,
    ),
    supportsListModels: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.supportsListModels !== false,
    getRegistryModels: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.registryModels ?? [],
    getProviderApiType: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.apiType ?? 'openai-completions',
    getDefaultBaseUrl: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.defaultBaseUrl ?? '',
    buildEndpointCandidates: buildMindosEndpointCandidates,
    fetch: async (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => fetch(input, init),
  };
}

async function testProviderConnectivity(input: {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  signal: AbortSignal;
}): Promise<void> {
  const preset = MINDOS_PROVIDER_PRESETS[input.provider];
  const apiType = preset?.apiType ?? 'openai-completions';
  const baseUrl = input.baseUrl || preset?.defaultBaseUrl || '';
  const model = input.model || preset?.defaultModel || '';

  if (!model) throw new Error('Model is required');
  if (!baseUrl) throw new Error('No base URL configured');

  if (apiType === 'anthropic-messages') {
    const endpoint = buildMindosEndpointCandidates(baseUrl, '/messages', apiType)[0];
    if (!endpoint) throw new Error('No endpoint configured');
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: input.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return;
  }

  if (apiType === 'gemini') {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: input.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return;
  }

  const endpoint = buildMindosEndpointCandidates(baseUrl, '/chat/completions', apiType)[0];
  if (!endpoint) throw new Error('No endpoint configured');
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}
