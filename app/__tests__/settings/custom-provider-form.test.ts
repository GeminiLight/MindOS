import { describe, expect, it } from 'vitest';
import { buildDefaultProviderName } from '@/components/settings/useCustomProviderForm';


describe('buildDefaultProviderName', () => {
  it('uses the protocol display name by default', () => {
    expect(buildDefaultProviderName('openai', [], undefined, 'en')).toBe('OpenAI');
  });

  it('appends numeric suffixes when the default name already exists', () => {
    expect(buildDefaultProviderName('openai', ['OpenAI'], undefined, 'en')).toBe('OpenAI 2');
    expect(buildDefaultProviderName('openai', ['OpenAI', 'OpenAI 2'], undefined, 'en')).toBe('OpenAI 3');
  });

  it('ignores the currently edited provider name when computing duplicates', () => {
    expect(buildDefaultProviderName('openai', ['OpenAI'], 'OpenAI', 'en')).toBe('OpenAI');
  });

  it('uses localized protocol name in Chinese', () => {
    expect(buildDefaultProviderName('minimax-cn', [], undefined, 'zh')).toBe('MiniMax (国内版)');
  });

  it('uses LM Studio as the default generated name', () => {
    expect(buildDefaultProviderName('lm-studio', [], undefined, 'en')).toBe('LM Studio');
  });

  it('uses vLLM as the default generated name', () => {
    expect(buildDefaultProviderName('vllm', [], undefined, 'en')).toBe('vLLM');
  });
});
