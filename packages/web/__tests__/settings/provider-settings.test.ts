import { describe, expect, it } from 'vitest';
import {
  buildDefaultProviderName,
  createProviderFromProtocol,
  rebaseProviderProtocol,
  resolveAiProviderSelection,
} from '@/lib/ai-provider-settings';
import type { AiSettings } from '@/components/settings/types';

describe('settings provider state helpers', () => {
  it('uses localized default provider names and numeric suffixes', () => {
    expect(buildDefaultProviderName('openai', [], undefined, 'en')).toBe('OpenAI');
    expect(buildDefaultProviderName('openai', ['OpenAI'], undefined, 'en')).toBe('OpenAI 2');
    expect(buildDefaultProviderName('openai', ['OpenAI', 'OpenAI 2'], undefined, 'en')).toBe('OpenAI 3');
    expect(buildDefaultProviderName('openai', ['OpenAI'], 'OpenAI', 'en')).toBe('OpenAI');
    expect(buildDefaultProviderName('minimax-cn', [], undefined, 'zh')).toBe('MiniMax (国内版)');
    expect(buildDefaultProviderName('lm-studio', [], undefined, 'en')).toBe('LM Studio');
    expect(buildDefaultProviderName('vllm', [], undefined, 'en')).toBe('vLLM');
  });

  it('creates and activates a provider entry when selecting an unconfigured protocol', () => {
    const openai = {
      id: 'p_openai01',
      name: 'OpenAI',
      protocol: 'openai' as const,
      apiKey: 'sk-openai',
      model: 'gpt-5.4',
      baseUrl: '',
    };
    const current: AiSettings = {
      activeProvider: openai.id,
      providers: [openai],
    };

    const next = resolveAiProviderSelection(current, 'anthropic', 'en', () => 'p_anthropic01');

    expect(next.activeProvider).toBe('p_anthropic01');
    expect(next.providers).toEqual([
      openai,
      {
        id: 'p_anthropic01',
        name: 'Anthropic',
        protocol: 'anthropic',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        baseUrl: '',
      },
    ]);
  });

  it('activates an existing provider entry instead of duplicating the same protocol', () => {
    const current: AiSettings = {
      activeProvider: 'p_openai01',
      providers: [
        { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        { id: 'p_anthropic01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
      ],
    };

    const next = resolveAiProviderSelection(current, 'anthropic', 'en', () => 'p_new');

    expect(next.activeProvider).toBe('p_anthropic01');
    expect(next.providers).toHaveLength(2);
  });

  it('keeps existing provider selections as entry ids', () => {
    const current: AiSettings = {
      activeProvider: 'p_openai01',
      providers: [
        { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        { id: 'p_google01', name: 'Google Gemini', protocol: 'google', apiKey: '', model: 'gemini-2.5-flash', baseUrl: '' },
      ],
    };

    const next = resolveAiProviderSelection(current, 'p_google01', 'en', () => 'p_new');

    expect(next.activeProvider).toBe('p_google01');
    expect(next.providers).toEqual(current.providers);
  });

  it('creates provider defaults with optional baseUrl for managed endpoints', () => {
    expect(createProviderFromProtocol('google', [], 'en', () => 'p_google01')).toEqual({
      id: 'p_google01',
      name: 'Google Gemini',
      protocol: 'google',
      apiKey: '',
      model: 'gemini-2.5-flash',
      baseUrl: '',
    });
  });

  it('resets connection details when changing an existing provider protocol', () => {
    const rebased = rebaseProviderProtocol(
      {
        id: 'p_openai01',
        name: 'OpenAI',
        protocol: 'openai',
        apiKey: 'sk-openai',
        model: 'custom-gpt',
        baseUrl: 'https://proxy.example/v1',
      },
      'deepseek',
      [],
      'en',
    );

    expect(rebased).toEqual({
      id: 'p_openai01',
      name: 'DeepSeek',
      protocol: 'deepseek',
      apiKey: '',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    });
  });

  it('preserves custom provider names when changing protocol', () => {
    const rebased = rebaseProviderProtocol(
      {
        id: 'p_proxy01',
        name: 'Work proxy',
        protocol: 'openai',
        apiKey: 'sk-openai',
        model: 'custom-gpt',
        baseUrl: 'https://proxy.example/v1',
      },
      'anthropic',
      [],
      'en',
    );

    expect(rebased.name).toBe('Work proxy');
    expect(rebased.apiKey).toBe('');
    expect(rebased.model).toBe('claude-sonnet-4-6');
    expect(rebased.baseUrl).toBe('');
  });
});
