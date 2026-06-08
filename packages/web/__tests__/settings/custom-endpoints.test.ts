import { describe, expect, it } from 'vitest';
import { migrateProviders, parseProviders } from '@/lib/custom-endpoints';

describe('parseProviders', () => {
  it('keeps a provider editable when an autosaved payload temporarily has an empty name', () => {
    expect(parseProviders([
      {
        id: 'p_openai01',
        name: '',
        protocol: 'openai',
        apiKey: '',
        model: 'gpt-5.4',
        baseUrl: '',
      },
    ])).toEqual([
      {
        id: 'p_openai01',
        name: 'OpenAI',
        protocol: 'openai',
        apiKey: '',
        model: 'gpt-5.4',
        baseUrl: '',
      },
    ]);
  });

  it('drops entries that cannot be repaired into provider configs', () => {
    expect(parseProviders([
      { id: 'openai', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
      { id: 'p_unknown01', name: 'Unknown', protocol: 'missing', apiKey: '', model: 'x', baseUrl: '' },
    ])).toEqual([]);
  });
});

describe('migrateProviders', () => {
  it('keeps an empty legacy activeProvider editable instead of falling back to another provider', () => {
    const migrated = migrateProviders({
      ai: {
        activeProvider: 'anthropic',
        providers: {
          openai: {},
          anthropic: {},
        },
      },
    });

    expect(migrated?.activeProvider).toBe(migrated?.providers[0]?.id);
    expect(migrated?.providers).toEqual([
      expect.objectContaining({
        name: 'Anthropic',
        protocol: 'anthropic',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        baseUrl: '',
      }),
    ]);
  });
});
