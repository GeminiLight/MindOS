import {
  expandSetupPathHome,
  validateMindRootPath,
  type MindosHttpServices,
  type MindosServerSettings,
  type MindosSetupServices,
  type MindosWebSearchConfig,
  type SettingsTestKeyModelInput,
} from '@geminilight/mindos/server';
import * as providers from '@/lib/agent/providers';
import { getEmbeddingStatus } from '@/lib/core/hybrid-search';
import * as tree from '@/lib/core/tree';
import * as customEndpoints from '@/lib/custom-endpoints';
import * as fsLib from '@/lib/fs';
import * as settingsLib from '@/lib/settings';
import * as template from '@/lib/template';
import * as webSearchConfig from '@/lib/web-search-config';

type WebSettingsServices = Pick<MindosHttpServices, 'settings' | 'settingsTestKey' | 'settingsListModels' | 'setup'>;

/**
 * Settings, provider connectivity and setup-wizard capabilities owned by the
 * Web host: its settings store (already normalised, so it bypasses the product
 * normaliser), web-search config, provider presets, the pi model client for
 * key tests and model listings, and the bundled templates for setup. Every
 * `@/lib` export is reached inside a function or getter so routes only touch
 * what their handler needs (tests mock `@/lib/settings` partially per route).
 */
export function createWebSettingsServices(): WebSettingsServices {
  return {
    settings: {
      env: process.env,
      readSettings: () => settingsLib.readSettings() as MindosServerSettings,
      writeSettings: (settings) => settingsLib.writeSettings(settings as settingsLib.ServerSettings),
      readWebSearchConfig: () => webSearchConfig.readWebSearchConfig() as MindosWebSearchConfig,
      writeWebSearchConfig: (config) => webSearchConfig.writeWebSearchConfig(config),
      parseProviders: (raw) => customEndpoints.parseProviders(raw),
      getEmbeddingStatus: () => getEmbeddingStatus(),
      invalidateCache: () => fsLib.invalidateCache(),
      readSearchIgnoreFile: (mindRoot) => (mindRoot ? tree.readMindosIgnoreFile(mindRoot) : []),
      writeSearchIgnoreFile: (mindRoot, ignoredPaths) => {
        tree.writeMindosIgnoreFile(mindRoot, ignoredPaths);
      },
      providerEnv: {
        get ids() {
          return [...providers.ALL_PROVIDER_IDS];
        },
        getApiKeyEnvVar: (id) => providers.getApiKeyEnvVar(id as providers.ProviderId),
        getApiKeyFromEnv: (id) => providers.getApiKeyFromEnv(id as providers.ProviderId),
      },
    },
    settingsTestKey: {
      isProviderId: (value) => providers.isProviderId(value),
      isProviderEntryId: (value) => customEndpoints.isProviderEntryId(value),
      readSettings: () => settingsLib.readSettings(),
      findProvider: (list, id) => customEndpoints.findProvider(list as customEndpoints.Provider[], id),
      effectiveAiConfig: (provider) => settingsLib.effectiveAiConfig(provider),
      testModel,
      clearCompatCacheForBaseUrl,
    },
    settingsListModels: {
      isProviderId: (value) => providers.isProviderId(value),
      isProviderEntryId: (value) => customEndpoints.isProviderEntryId(value),
      readSettings: () => settingsLib.readSettings(),
      findProvider: (list, id) => customEndpoints.findProvider(list as customEndpoints.Provider[], id),
      effectiveAiConfig: (provider) => settingsLib.effectiveAiConfig(provider),
      supportsListModels: (provider) => providers.PROVIDER_PRESETS[provider as providers.ProviderId]?.supportsListModels !== false,
      getRegistryModels,
      getProviderApiType: (provider) => providers.getProviderApiType(provider as providers.ProviderId),
      getDefaultBaseUrl: (provider) => providers.getDefaultBaseUrl(provider as providers.ProviderId),
      buildEndpointCandidates: (baseUrl, path, apiType) => providers.buildCompatEndpointCandidates(baseUrl, path, apiType),
      fetch: async (input, init) => fetch(input, init),
    },
    setup: {
      readSettings: () => settingsLib.readSettings() as unknown as ReturnType<MindosSetupServices['readSettings']>,
      writeSettings: (settings) => settingsLib.writeSettings(settings as unknown as settingsLib.ServerSettings),
      applyTemplate: (name, mindRoot) => {
        template.applyTemplate(name, mindRoot);
        return { ok: true };
      },
      applyInitialSpaces: (initialSpaces, mindRoot, locale) => {
        const result = template.applyInitialSpaces(initialSpaces as template.InitialSpaceId[], mindRoot, locale as template.InitialSpaceLocale);
        return { ok: true, installed: result.installed };
      },
      expandPathHome: expandSetupPathHome,
      validateMindRootPath,
      isProviderId: (value) => providers.isProviderId(value),
      generateProviderId: () => customEndpoints.generateProviderId(),
      get providerPresets() {
        return providers.PROVIDER_PRESETS;
      },
    },
  };
}

/** Real model round-trip through the pi client so compat quirks (streaming vs non-streaming) are exercised. */
async function testModel({ provider, apiKey, model, baseUrl, signal }: SettingsTestKeyModelInput): Promise<void> {
  const { getModelConfig } = await import('@/lib/agent/model');
  const { model: piModel } = await getModelConfig({
    provider: provider as providers.ProviderId,
    apiKey,
    model,
    baseUrl: baseUrl || undefined,
  });
  const { completeWithPiModels } = await import('@/lib/agent/pi-models');
  await completeWithPiModels(piModel, {
    messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
  }, {
    apiKey,
    signal,
  });
}

function normalizeBaseUrl(url: string): string {
  if (!url) return url;
  return url.trim().replace(/\/+$/, '');
}

/** A successful test invalidates any remembered compat mode for that base URL so the next call re-probes it. */
function clearCompatCacheForBaseUrl(baseUrl?: string): void {
  try {
    const normalized = normalizeBaseUrl(baseUrl ?? '');
    if (!normalized) return;

    const compat = settingsLib.readBaseUrlCompat();
    if (!compat[normalized]) return;

    const settings = settingsLib.readSettings();
    const updated = { ...(settings.baseUrlCompat ?? {}) };
    delete updated[normalized];
    settingsLib.writeSettings({ ...settings, baseUrlCompat: updated });
  } catch {
    // Cache cleanup must never turn a successful connectivity test into a failure.
  }
}

async function getRegistryModels(provider: string): Promise<string[]> {
  try {
    const { listPiBuiltinModels } = await import('@/lib/agent/pi-models');
    const models = await listPiBuiltinModels(providers.toPiProvider(provider as providers.ProviderId));
    return models.map((model: { id: string }) => model.id).filter(Boolean).sort();
  } catch {
    return [];
  }
}
