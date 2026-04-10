import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, getDefaultBaseUrl, groupedProviders } from '@/lib/agent/providers';


describe('provider presets', () => {
  it('includes LM Studio as an explicit local preset', () => {
    const preset = PROVIDER_PRESETS['lm-studio'];
    expect(preset.name).toBe('LM Studio');
    expect(preset.fixedBaseUrl).toBe('http://localhost:1234/v1');
    expect(preset.apiKeyFallback).toBe('lm-studio');
    expect(preset.supportsListModels).toBe(true);
  });

  it('resolves LM Studio default base URL from its fixed preset URL', () => {
    expect(getDefaultBaseUrl('lm-studio')).toBe('http://localhost:1234/v1');
  });

  it('includes vLLM as an explicit local preset', () => {
    const preset = PROVIDER_PRESETS.vllm;
    expect(preset.name).toBe('vLLM');
    expect(preset.fixedBaseUrl).toBe('http://localhost:8000/v1');
    expect(preset.apiKeyFallback).toBe('vllm');
    expect(preset.supportsListModels).toBe(true);
  });

  it('groups Ollama, LM Studio, and vLLM under local providers', () => {
    const groups = groupedProviders();
    expect(groups.local).toContain('ollama');
    expect(groups.local).toContain('lm-studio');
    expect(groups.local).toContain('vllm');
  });
});
