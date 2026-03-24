import { describe, expect, it } from 'vitest';
import { isAiConfiguredForAsk } from '@/lib/settings-ai-client';

describe('isAiConfiguredForAsk', () => {
  it('returns true when anthropic file key is set', () => {
    expect(
      isAiConfiguredForAsk({
        ai: {
          provider: 'anthropic',
          providers: { anthropic: { apiKey: '***set***' }, openai: { apiKey: '' } },
        },
        envOverrides: {},
      }),
    ).toBe(true);
  });

  it('returns true when anthropic env override only', () => {
    expect(
      isAiConfiguredForAsk({
        ai: {
          provider: 'anthropic',
          providers: { anthropic: { apiKey: '' }, openai: { apiKey: '' } },
        },
        envOverrides: { ANTHROPIC_API_KEY: true },
      }),
    ).toBe(true);
  });

  it('returns false when anthropic selected but no key anywhere', () => {
    expect(
      isAiConfiguredForAsk({
        ai: {
          provider: 'anthropic',
          providers: { anthropic: { apiKey: '' }, openai: { apiKey: '***set***' } },
        },
        envOverrides: {},
      }),
    ).toBe(false);
  });

  it('returns true when openai provider and openai key set', () => {
    expect(
      isAiConfiguredForAsk({
        ai: {
          provider: 'openai',
          providers: { anthropic: { apiKey: '' }, openai: { apiKey: '***set***' } },
        },
        envOverrides: {},
      }),
    ).toBe(true);
  });

  it('returns true for openai env only', () => {
    expect(
      isAiConfiguredForAsk({
        ai: {
          provider: 'openai',
          providers: { anthropic: { apiKey: '' }, openai: { apiKey: '' } },
        },
        envOverrides: { OPENAI_API_KEY: true },
      }),
    ).toBe(true);
  });

  it('treats missing provider as anthropic (error path)', () => {
    expect(
      isAiConfiguredForAsk({
        ai: { providers: { anthropic: { apiKey: '' }, openai: { apiKey: '' } } },
        envOverrides: {},
      }),
    ).toBe(false);
  });
});
