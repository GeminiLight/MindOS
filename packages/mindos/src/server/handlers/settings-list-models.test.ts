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

  const remoteModels = ['anthropic/claude-sonnet-4.6', 'minimax/minimax-m2.7', 'minimax/minimax-m3', 'minimax/minimax-m3.1-flash:free', 'minimax/minimax-01', 'minimax/speech-example'];
  it.each(['', 'https://openrouter.ai/api/v1', 'https://custom.example/v1'])('filters only the verified OpenRouter picker at %s', async baseUrl => {
    const response = await handleSettingsListModelsPost({ provider: 'openrouter', apiKey: 'fixture', baseUrl }, {
      getDefaultBaseUrl: () => 'https://openrouter.ai/api/v1',
      fetch: async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ data: remoteModels.map(id => ({ id })) }) }),
    });
    expect(response.body).toEqual({
      ok: true,
      models: baseUrl.startsWith('https://custom') ? [...remoteModels].sort() : [
        'anthropic/claude-sonnet-4.6', 'minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3', 'minimax/speech-example',
      ],
    });
  });
});
