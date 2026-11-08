import { describe, expect, it, vi } from 'vitest';
import { createStandalonePiHostServices } from './agent-runtime.js';

vi.mock('../foundation/native-import.js', () => ({ nativeImport: (specifier: string) => import(specifier) }));

describe('standalone Requesty model routing', () => {
  it.each([
    ['openai/gpt-4o-mini', '', 'https://router.requesty.ai/v1'],
    ['gpt-4o-mini', '', 'https://router.requesty.ai/v1'],
    ['gpt-4o-mini', 'https://router.eu.requesty.ai/v1/', 'https://router.eu.requesty.ai/v1'],
  ])('routes %s using the configured Requesty endpoint %s', async (model, baseUrl, expectedUrl) => {
    const host = createStandalonePiHostServices({ ai: {
      providers: [{ id: 'fixture', protocol: 'requesty', model, apiKey: 'fixture-only', baseUrl }],
    } });
    const resolved = await host.resolveModelConfig({ messages: [], hasImages: false });
    expect(resolved.model).toMatchObject({ id: model, api: 'openai-completions', baseUrl: expectedUrl });
  });
});
