import { describe, expect, it, vi } from 'vitest';
import { createStandalonePiHostServices } from './agent-runtime.js';

vi.mock('../foundation/native-import.js', () => ({ nativeImport: (specifier: string) => import(specifier) }));

describe('standalone UberLLM model routing', () => {
  it.each([
    ['deepseek/deepseek-v4.1-flash', '', 'https://api.uberllm.dev/v1'],
    ['gpt-4o-mini', '', 'https://api.uberllm.dev/v1'],
    ['gpt-4o-mini', 'https://api.uberllm.dev/v1/', 'https://api.uberllm.dev/v1'],
  ])('routes %s using the configured UberLLM endpoint %s', async (model, baseUrl, expectedUrl) => {
    const host = createStandalonePiHostServices({ ai: {
      providers: [{ id: 'fixture', protocol: 'uberllm', model, apiKey: 'fixture-only', baseUrl }],
    } });
    const resolved = await host.resolveModelConfig({ messages: [], hasImages: false });
    expect(resolved.model).toMatchObject({ id: model, api: 'openai-completions', baseUrl: expectedUrl });
  });
});
