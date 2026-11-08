import { describe, expect, it, vi } from 'vitest';
import { MINDOS_PROVIDER_PRESETS } from '../provider-settings.js';
import { handleSettingsListModelsPost } from './settings-list-models.js';

describe('MiniMax model choices', () => {
  it.each(['minimax', 'minimax-cn'])('keeps Flash first for new and saved %s providers', async protocol => {
    const preset = MINDOS_PROVIDER_PRESETS[protocol];
    const fetch = vi.fn();
    const services = {
      isProviderId: (id: string) => id === protocol,
      supportsListModels: () => false,
      getRegistryModels: () => preset.registryModels ?? [],
      getDefaultBaseUrl: () => preset.defaultBaseUrl,
      readSettings: () => ({ ai: { providers: [] } }),
      findProvider: () => ({ protocol, baseUrl: preset.defaultBaseUrl }),
      fetch,
    };
    for (const provider of [protocol, 'p_saved']) {
      const response = await handleSettingsListModelsPost({ provider }, services);
      expect(response.body).toEqual({ ok: true, models: ['MiniMax-M3.1-Flash', 'MiniMax-M3'] });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', 'https://custom.example/v1'])('keeps the OpenRouter catalog returned by %s', async baseUrl => {
    const remoteModels = ['minimax/minimax-m3.1-flash', 'minimax/minimax-m3', 'minimax/minimax-m2.7'];
    const response = await handleSettingsListModelsPost({ provider: 'openrouter', apiKey: 'fixture', baseUrl }, {
      getDefaultBaseUrl: () => 'https://openrouter.ai/api/v1',
      fetch: async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ data: remoteModels.map(id => ({ id })) }) }),
    });
    expect(response.body).toEqual({ ok: true, models: [...remoteModels].sort() });
  });
});
