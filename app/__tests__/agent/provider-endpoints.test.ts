import { describe, expect, it } from 'vitest';
import { buildCompatEndpointCandidates, getProviderApiType } from '@/lib/agent/providers';


describe('buildCompatEndpointCandidates', () => {
  it('keeps OpenAI-compatible custom path and adds v1 fallback', () => {
    const endpoints = buildCompatEndpointCandidates(
      'https://proxy.example.com/custom',
      '/chat/completions',
      'openai-completions',
    );

    expect(endpoints).toEqual([
      'https://proxy.example.com/custom/chat/completions',
      'https://proxy.example.com/custom/v1/chat/completions',
    ]);
  });

  it('keeps existing version prefix without adding another v1', () => {
    const endpoints = buildCompatEndpointCandidates(
      'https://api.openai.com/v1',
      '/chat/completions',
      'openai-completions',
    );

    expect(endpoints).toEqual([
      'https://api.openai.com/v1/chat/completions',
    ]);
  });

  it('preserves GLM path prefix without injecting an extra v1 after /v4', () => {
    const endpoints = buildCompatEndpointCandidates(
      'https://api.z.ai/api/coding/paas/v4',
      '/models',
      'openai-completions',
    );

    expect(endpoints).toEqual([
      'https://api.z.ai/api/coding/paas/v4/models',
    ]);
  });

  it('preserves Anthropic-compatible path prefixes for Kimi/MiniMax style gateways', () => {
    const endpoints = buildCompatEndpointCandidates(
      'https://api.kimi.com/coding',
      '/models',
      'anthropic-messages',
    );

    expect(endpoints).toEqual([
      'https://api.kimi.com/coding/models',
      'https://api.kimi.com/coding/v1/models',
    ]);
  });
});


describe('getProviderApiType', () => {
  it('reports GLM as openai-completions', () => {
    expect(getProviderApiType('zai')).toBe('openai-completions');
  });

  it('reports MiniMax CN as anthropic-messages', () => {
    expect(getProviderApiType('minimax-cn')).toBe('anthropic-messages');
  });

  it('reports Kimi Coding as anthropic-messages', () => {
    expect(getProviderApiType('kimi-coding')).toBe('anthropic-messages');
  });
});
