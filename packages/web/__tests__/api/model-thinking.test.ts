import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetModelConfig = vi.fn();
const mockGetSupportedThinkingLevels = vi.fn();

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({
    ai: {
      activeProvider: 'p_openai',
      providers: [{
        id: 'p_openai',
        name: 'OpenAI',
        protocol: 'openai',
        apiKey: 'secret',
        model: 'gpt-5.4',
        baseUrl: '',
      }],
    },
  }),
}));

vi.mock('@/lib/agent/model', () => ({
  getModelConfig: (...args: unknown[]) => mockGetModelConfig(...args),
}));

vi.mock('@/lib/agent/pi-models', () => ({
  getPiSupportedThinkingLevels: (...args: unknown[]) => mockGetSupportedThinkingLevels(...args),
}));

import { POST } from '../../app/api/settings/model-thinking/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/settings/model-thinking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/settings/model-thinking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelConfig.mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai', reasoning: true },
      modelName: 'gpt-5.4',
      provider: 'openai',
      resolvedCaps: { reasoning: true },
    });
    mockGetSupportedThinkingLevels.mockResolvedValue([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('returns concrete model-level Pi effort options without exposing credentials', async () => {
    const response = await POST(request({ provider: 'p_openai', model: 'gpt-5.4' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      provider: 'p_openai',
      model: 'gpt-5.4',
      reasoning: true,
      defaultLevel: 'off',
      levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    });
    expect(mockGetModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      apiKey: 'secret',
      model: 'gpt-5.4',
    }));
  });

  it('returns only off for a non-reasoning model', async () => {
    mockGetModelConfig.mockResolvedValueOnce({
      model: { id: 'plain-model', provider: 'openai', reasoning: false },
      modelName: 'plain-model',
      provider: 'openai',
      resolvedCaps: { reasoning: false },
    });
    mockGetSupportedThinkingLevels.mockResolvedValueOnce(['off']);

    const response = await POST(request({ provider: 'p_openai', model: 'plain-model' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      model: 'plain-model',
      reasoning: false,
      levels: ['off'],
    });
  });

  it('rejects a stale provider selection instead of silently using another credential', async () => {
    const response = await POST(request({ provider: 'p_missing', model: 'gpt-5.4' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Provider not found',
    });
    expect(mockGetModelConfig).not.toHaveBeenCalled();
  });
});
