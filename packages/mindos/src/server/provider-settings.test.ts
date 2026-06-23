import { describe, expect, it } from 'vitest';
import {
  normalizeMindosProvider,
  parseMindosProviders,
} from './provider-settings.js';

describe('MindOS provider settings capability metadata', () => {
  it('preserves validated provider and per-model caps for new-format provider entries', () => {
    expect(normalizeMindosProvider({
      id: 'p_stepfun01',
      name: 'StepFun',
      protocol: 'openai',
      apiKey: 'sk-test',
      model: 'step-3.7-flash',
      baseUrl: 'https://api.stepfun.com/v1',
      contextWindow: 256_000.9,
      contextTokens: 200_000,
      maxTokens: 32_000,
      models: [
        {
          id: 'step-3.7-flash',
          contextWindow: 256_000,
          contextTokens: 180_000,
          maxTokens: 64_000,
          input: ['text', 'audio', 'text', 'bad'],
          reasoning: true,
          source: 'user',
          updatedAt: ' 2026-06-24T00:00:00.000Z ',
        },
        {
          id: 'bad-numbers',
          contextWindow: 0,
          contextTokens: Number.POSITIVE_INFINITY,
          maxTokens: -1,
        },
      ],
    })).toEqual({
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
          input: ['text', 'audio'],
          reasoning: true,
          source: 'user',
          updatedAt: '2026-06-24T00:00:00.000Z',
        },
      ],
    });
  });

  it('preserves caps when migrating legacy protocol-keyed provider config', () => {
    expect(parseMindosProviders({
      openai: {
        apiKey: 'sk-test',
        model: 'step-3.7-flash',
        baseUrl: 'https://api.stepfun.com/v1',
        contextWindow: 256_000,
        contextTokens: 196_000,
        maxTokens: 64_000,
        models: [
          { id: 'step-3.7-flash', contextWindow: 256_000, source: 'catalog' },
        ],
      },
      anthropic: {},
    }, 'anthropic')).toEqual([
      {
        id: 'p_openai',
        name: 'OpenAI',
        protocol: 'openai',
        apiKey: 'sk-test',
        model: 'step-3.7-flash',
        baseUrl: 'https://api.stepfun.com/v1',
        contextWindow: 256_000,
        contextTokens: 196_000,
        maxTokens: 64_000,
        models: [
          { id: 'step-3.7-flash', contextWindow: 256_000, source: 'catalog' },
        ],
      },
      {
        id: 'p_anthropic',
        name: 'Anthropic',
        protocol: 'anthropic',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        baseUrl: 'https://api.anthropic.com/v1',
      },
    ]);
  });
});
