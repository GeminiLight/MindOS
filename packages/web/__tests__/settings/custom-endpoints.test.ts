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

  it('preserves validated provider and per-model capability metadata', () => {
    expect(parseProviders([
      {
        id: 'p_stepfun01',
        name: 'StepFun',
        protocol: 'openai',
        apiKey: 'sk-test',
        model: 'step-3.7-flash',
        baseUrl: 'https://api.stepfun.com/v1',
        contextWindow: 256_000.8,
        contextTokens: 200_000,
        maxTokens: 32_000,
        models: [
          {
            id: 'step-3.7-flash',
            contextWindow: 256_000,
            contextTokens: 180_000,
            maxTokens: 64_000,
            input: ['text', 'image', 'text', 'bad'],
            reasoning: true,
            source: 'user',
            updatedAt: ' 2026-06-24T00:00:00.000Z ',
          },
          {
            id: 'bad-numbers',
            contextWindow: -1,
            contextTokens: Number.NaN,
            maxTokens: 0,
          },
          { id: '' },
        ],
      },
    ])).toEqual([
      {
        id: 'p_stepfun01',
        name: 'StepFun',
        protocol: 'openai',
        apiKey: 'sk-test',
        model: 'step-3.7-flash',
        baseUrl: 'https://api.stepfun.com/v1',
        contextWindow: 256_000,
        contextTokens: 200_000,
        maxTokens: 32_000,
        models: [
          {
            id: 'step-3.7-flash',
            contextWindow: 256_000,
            contextTokens: 180_000,
            maxTokens: 64_000,
            input: ['text', 'image'],
            reasoning: true,
            source: 'user',
            updatedAt: '2026-06-24T00:00:00.000Z',
          },
        ],
      },
    ]);
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
