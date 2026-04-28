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
    const result = getModelConfig({
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
    const result = getModelConfig({
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
});
