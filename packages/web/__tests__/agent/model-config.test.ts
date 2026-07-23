import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('provider override resolution', () => {
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-provider-test-'));
    const mindosDir = path.join(tempHome, '.mindos');
    fs.mkdirSync(mindosDir, { recursive: true });
    configPath = path.join(mindosDir, 'config.json');
    vi.resetModules();
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('prefers explicit overrides over active provider config', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: {
        activeProvider: 'p_anthropic',
        providers: [
          {
            id: 'p_anthropic',
            name: 'Anthropic',
            protocol: 'anthropic',
            apiKey: 'sk-ant-test',
            model: 'claude-sonnet-4-6',
            baseUrl: '',
          },
        ],
      },
    }), 'utf-8');

    const { getModelConfig } = await import('@/lib/agent/model');
    const result = await getModelConfig({
      provider: 'openai',
      apiKey: 'venus-key',
      model: 'venus-model',
      baseUrl: 'http://v2.open.venus.oa.com/llmproxy',
    });

    expect(result.provider).toBe('openai');
    expect(result.apiKey).toBe('venus-key');
    expect(result.modelName).toBe('venus-model');
    expect(result.baseUrl).toBe('http://v2.open.venus.oa.com/llmproxy');
    expect(result.model.provider).toBe('openai');
    expect(result.model.baseUrl).toBe('http://v2.open.venus.oa.com/llmproxy');
  });

  it('keeps the explicit provider override in getModelConfig', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: {
        activeProvider: 'p_anthropic',
        providers: [
          {
            id: 'p_anthropic',
            name: 'Anthropic',
            protocol: 'anthropic',
            apiKey: 'sk-ant-test',
            model: 'claude-sonnet-4-6',
            baseUrl: '',
          },
        ],
      },
    }), 'utf-8');

    const { getModelConfig } = await import('@/lib/agent/model');
    const result = await getModelConfig({
      provider: 'openai',
      apiKey: 'venus-key',
      model: 'venus-model',
      baseUrl: 'http://v2.open.venus.oa.com/llmproxy',
    });

    expect(result.provider).toBe('openai');
    expect(result.apiKey).toBe('venus-key');
    expect(result.modelName).toBe('venus-model');
    expect(result.baseUrl).toBe('http://v2.open.venus.oa.com/llmproxy');
    expect(result.model.provider).toBe('openai');
  });

  it('marks unknown model windows as fallback metadata while still giving the runtime a cap', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: { activeProvider: '', providers: [] },
    }), 'utf-8');

    const { getModelConfig } = await import('@/lib/agent/model');
    const result = await getModelConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'unknown-local-model',
      baseUrl: 'https://api.unknown.example/v1',
    });

    expect(result.model.contextWindow).toBe(128_000);
    expect(result.resolvedCaps).toMatchObject({
      source: 'fallback',
      isFallback: true,
      effectiveContextWindow: 128_000,
    });
    expect(result.model.mindosCaps).toMatchObject({
      source: 'fallback',
      isFallback: true,
    });
    expect(result.model.mindosCaps?.contextWindow).toBeUndefined();
  });

  it('uses provider-entry model caps to drive the runtime model context window', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: { activeProvider: '', providers: [] },
    }), 'utf-8');

    const { getModelConfig } = await import('@/lib/agent/model');
    const result = await getModelConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'step-3.7-flash',
      baseUrl: 'https://api.stepfun.com/v1',
      providerEntry: {
        id: 'p_stepfun',
        name: 'StepFun',
        protocol: 'openai',
        apiKey: 'test-key',
        model: 'step-3.7-flash',
        baseUrl: 'https://api.stepfun.com/v1',
        models: [
          { id: 'step-3.7-flash', contextWindow: 256_000, contextTokens: 180_000, maxTokens: 64_000 },
        ],
      },
    });

    expect(result.model.contextWindow).toBe(180_000);
    expect(result.model.maxTokens).toBe(64_000);
    expect(result.resolvedCaps).toMatchObject({
      providerEntryId: 'p_stepfun',
      source: 'user',
      contextWindow: 256_000,
      contextTokens: 180_000,
      effectiveContextWindow: 180_000,
    });
  });

  it('does not reuse saved provider-entry caps when an explicit endpoint override changes the concrete endpoint', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: {
        activeProvider: 'p_openai',
        providers: [
          {
            id: 'p_openai',
            name: 'OpenAI',
            protocol: 'openai',
            apiKey: 'saved-key',
            model: 'saved-model',
            baseUrl: 'https://api.openai.com/v1',
            contextWindow: 400_000,
          },
        ],
      },
    }), 'utf-8');

    const { getModelConfig } = await import('@/lib/agent/model');
    const result = await getModelConfig({
      provider: 'openai',
      apiKey: 'override-key',
      model: 'unknown-proxy-model',
      baseUrl: 'https://proxy.example.com/v1',
    });

    expect(result.resolvedCaps).toMatchObject({
      source: 'fallback',
      isFallback: true,
      effectiveContextWindow: 128_000,
    });
    expect(result.resolvedCaps.providerEntryId).toBeUndefined();
  });

  it('uses concrete endpoint catalog caps for StepFun-compatible provider entries', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: { activeProvider: '', providers: [] },
    }), 'utf-8');

    const { getModelConfig } = await import('@/lib/agent/model');
    const result = await getModelConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'step-3.7-flash',
      baseUrl: 'https://api.stepfun.com/v1',
    });

    expect(result.model.contextWindow).toBe(256_000);
    expect(result.model.maxTokens).toBe(256_000);
    expect(result.resolvedCaps).toMatchObject({
      source: 'catalog',
      isFallback: false,
      contextWindow: 256_000,
      effectiveContextWindow: 256_000,
    });
  });

  it('writes resolved reasoning capability back to a custom model without disabling effort compatibility', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: { activeProvider: '', providers: [] },
    }), 'utf-8');

    const { getModelConfig } = await import('@/lib/agent/model');
    const result = await getModelConfig({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'reasoning-proxy-model',
      baseUrl: 'https://proxy.example.com/v1',
      providerEntry: {
        id: 'p_reasoning',
        name: 'Reasoning proxy',
        protocol: 'openai',
        apiKey: 'test-key',
        model: 'reasoning-proxy-model',
        baseUrl: 'https://proxy.example.com/v1',
        models: [
          {
            id: 'reasoning-proxy-model',
            reasoning: true,
            contextWindow: 256_000,
          },
        ],
      },
    });

    expect(result.model.reasoning).toBe(true);
    expect(result.resolvedCaps.reasoning).toBe(true);
    expect(result.model.compat).not.toMatchObject({
      supportsReasoningEffort: false,
    });
  });
});
