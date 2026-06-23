import { describe, expect, it } from 'vitest';
import type { Provider } from '@/lib/custom-endpoints';
import {
  UNKNOWN_MODEL_CONTEXT_FALLBACK,
  resolveModelCapabilities,
} from '@/lib/agent/model-capabilities';

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p_test',
    name: 'Test Provider',
    protocol: 'openai',
    apiKey: 'sk-test',
    model: 'test-model',
    baseUrl: 'https://api.example.com/v1',
    ...overrides,
  };
}

describe('resolveModelCapabilities', () => {
  it('lets a provider-entry per-model override beat provider defaults, catalog, pi-ai, and fallback', () => {
    const caps = resolveModelCapabilities({
      providerEntry: provider({
        id: 'p_stepfun',
        contextWindow: 100_000,
        contextTokens: 90_000,
        maxTokens: 8_000,
        models: [
          {
            id: 'step-3.7-flash',
            contextWindow: 256_000,
            contextTokens: 180_000,
            maxTokens: 64_000,
            input: ['text', 'image'],
            reasoning: true,
          },
        ],
      }),
      protocol: 'openai',
      baseUrl: 'https://api.stepfun.com/v1',
      modelId: 'step-3.7-flash',
      registryModel: { contextWindow: 400_000, maxTokens: 128_000 },
    });

    expect(caps).toMatchObject({
      providerEntryId: 'p_stepfun',
      source: 'user',
      isFallback: false,
      contextWindow: 256_000,
      contextTokens: 180_000,
      effectiveContextWindow: 180_000,
      maxTokens: 64_000,
      input: ['text', 'image'],
      reasoning: true,
    });
  });

  it('uses provider-entry defaults before catalog and registry metadata', () => {
    const caps = resolveModelCapabilities({
      providerEntry: provider({
        id: 'p_stepfun',
        contextWindow: 120_000,
        contextTokens: 96_000,
        maxTokens: 12_000,
      }),
      protocol: 'openai',
      baseUrl: 'https://api.stepfun.com/v1',
      modelId: 'step-3.7-flash',
      registryModel: { contextWindow: 400_000, maxTokens: 128_000 },
    });

    expect(caps).toMatchObject({
      providerEntryId: 'p_stepfun',
      source: 'user',
      contextWindow: 120_000,
      contextTokens: 96_000,
      effectiveContextWindow: 96_000,
      maxTokens: 12_000,
    });
  });

  it('uses the StepFun catalog only for known StepFun endpoint identities', () => {
    const stepfun = resolveModelCapabilities({
      protocol: 'openai',
      baseUrl: 'https://api.stepfun.com/v1',
      modelId: 'step-3.7-flash',
    });
    const openaiDirect = resolveModelCapabilities({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'step-3.7-flash',
    });

    expect(stepfun).toMatchObject({
      source: 'catalog',
      contextWindow: 256_000,
      effectiveContextWindow: 256_000,
      maxTokens: 256_000,
      reasoning: true,
    });
    expect(openaiDirect).toMatchObject({
      source: 'fallback',
      isFallback: true,
      effectiveContextWindow: UNKNOWN_MODEL_CONTEXT_FALLBACK,
    });
  });

  it('uses pi-ai registry metadata when no provider-entry or catalog caps are present', () => {
    const caps = resolveModelCapabilities({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-5',
      registryModel: {
        contextWindow: 400_000,
        maxTokens: 128_000,
        input: ['text', 'image', 'image', 'bad'],
        reasoning: false,
      },
    });

    expect(caps).toMatchObject({
      source: 'pi-ai',
      isFallback: false,
      contextWindow: 400_000,
      effectiveContextWindow: 400_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      reasoning: false,
    });
  });

  it('marks unknown model caps as an explicit fallback instead of pretending the fallback is native', () => {
    const caps = resolveModelCapabilities({
      protocol: 'openai',
      baseUrl: 'https://api.unknown.example/v1',
      modelId: 'unknown-model',
    });

    expect(caps.contextWindow).toBeUndefined();
    expect(caps).toMatchObject({
      source: 'fallback',
      isFallback: true,
      effectiveContextWindow: UNKNOWN_MODEL_CONTEXT_FALLBACK,
    });
    expect(caps.warnings.join('\n')).toContain('Unknown model context window for unknown-model');
  });

  it('matches slash-containing model IDs exactly', () => {
    const caps = resolveModelCapabilities({
      providerEntry: provider({
        protocol: 'openrouter',
        models: [
          { id: 'anthropic/claude-sonnet-4', contextWindow: 1_000_000, maxTokens: 64_000 },
          { id: 'claude-sonnet-4', contextWindow: 200_000, maxTokens: 16_000 },
        ],
      }),
      protocol: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      modelId: 'anthropic/claude-sonnet-4',
    });

    expect(caps).toMatchObject({
      source: 'user',
      contextWindow: 1_000_000,
      effectiveContextWindow: 1_000_000,
      maxTokens: 64_000,
    });
  });

  it('caps the effective budget when contextTokens is lower than native contextWindow', () => {
    const caps = resolveModelCapabilities({
      providerEntry: provider({
        models: [
          { id: 'big-model', contextWindow: 256_000, contextTokens: 64_000 },
        ],
      }),
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'big-model',
    });

    expect(caps).toMatchObject({
      source: 'user',
      contextWindow: 256_000,
      contextTokens: 64_000,
      effectiveContextWindow: 64_000,
    });
  });

  it('warns and clamps when contextTokens is larger than contextWindow', () => {
    const caps = resolveModelCapabilities({
      providerEntry: provider({
        models: [
          { id: 'small-model', contextWindow: 32_000, contextTokens: 64_000 },
        ],
      }),
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'small-model',
    });

    expect(caps.effectiveContextWindow).toBe(32_000);
    expect(caps.warnings.join('\n')).toContain('contextTokens 64000 exceeds contextWindow 32000');
  });
});
