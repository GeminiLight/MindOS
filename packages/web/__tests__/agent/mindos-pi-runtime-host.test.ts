import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('createWebMindosPiRuntimeHostServices model config resolution', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-pi-host-test-'));
    fs.mkdirSync(path.join(tempHome, '.mindos'), { recursive: true });
    fs.writeFileSync(path.join(tempHome, '.mindos', 'config.json'), JSON.stringify({
      mindRoot: '/tmp/mind',
      ai: { activeProvider: '', providers: [] },
    }), 'utf-8');
    vi.resetModules();
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('passes concrete p_* provider-entry caps into getModelConfig for MindOS Pi runtime', async () => {
    const { createWebMindosPiRuntimeHostServices } = await import('@/lib/agent/mindos-pi-runtime-host');
    const services = createWebMindosPiRuntimeHostServices({
      ai: {
        providers: [
          {
            id: 'p_stepfun',
            name: 'StepFun',
            protocol: 'openai',
            apiKey: 'sk-test',
            model: 'step-3.7-flash',
            baseUrl: 'https://api.stepfun.com/v1',
            models: [
              { id: 'step-3.7-flash', contextWindow: 256_000, contextTokens: 180_000, maxTokens: 64_000 },
            ],
          },
        ],
      },
    });

    const config = await services.resolveModelConfig({
      providerOverride: 'p_stepfun',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(config.modelName).toBe('step-3.7-flash');
    expect(config.provider).toBe('openai');
    expect(config.baseUrl).toBe('https://api.stepfun.com/v1');
    expect(config.model.contextWindow).toBe(180_000);
    expect(config.model.maxTokens).toBe(64_000);
    expect(config.model.mindosCaps).toMatchObject({
      providerEntryId: 'p_stepfun',
      source: 'user',
      contextWindow: 256_000,
      contextTokens: 180_000,
      effectiveContextWindow: 180_000,
    });
  });
});
