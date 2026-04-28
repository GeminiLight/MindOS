import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock pi-ai complete
vi.mock('@mariozechner/pi-ai', () => ({
  complete: vi.fn(),
  getModel: vi.fn(),
}));

// Mock getModelConfig to avoid loading the real pi-ai registry
vi.mock('@/lib/agent/model', () => ({
  getModelConfig: vi.fn(() => ({
    model: { id: 'mock-model', api: 'openai-completions', provider: 'openai' },
    modelName: 'mock-model',
    apiKey: 'mock-key',
    provider: 'anthropic',
  })),
}));

import { POST } from '../../app/api/settings/test-key/route';
import { complete } from '@mariozechner/pi-ai';
import { getModelConfig } from '@/lib/agent/model';

function makeReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/settings/test-key', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/settings/test-key', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid provider', async () => {
    const res = await POST(makeReq({ provider: 'invalid', apiKey: 'test' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Invalid provider');
  });

  it('returns auth_error when no key configured', async () => {
    const res = await POST(makeReq({ provider: 'anthropic' }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('auth_error');
    expect(body.error).toBe('No API key configured');
  });

  it('returns ok when pi-ai complete() succeeds', async () => {
    (complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ text: 'hello' });

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.latency).toBeTypeOf('number');

    expect(getModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
    }));

    expect(complete).toHaveBeenCalledOnce();
  });

  it('passes overrides to getModelConfig for unsaved values', async () => {
    (complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ text: 'ok' });

    await POST(makeReq({
      provider: 'openai',
      apiKey: 'sk-new-key',
      model: 'gpt-5.4',
      baseUrl: 'https://custom.api.com/v1',
    }));

    expect(getModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      apiKey: 'sk-new-key',
      model: 'gpt-5.4',
      baseUrl: 'https://custom.api.com/v1',
    }));
  });

  it('classifies auth errors from pi-ai', async () => {
    (complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('401 Unauthorized: Invalid API key'),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'bad-key' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('auth_error');
  });

  it('classifies endpoint mismatch errors separately from missing models', async () => {
    (complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('404 page not found'),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-test', model: 'nonexistent-model' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('endpoint_error');
  });

  it('classifies rate limit errors', async () => {
    (complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('429 Rate limit exceeded'),
    );

    const res = await POST(makeReq({ provider: 'groq', apiKey: 'sk-test' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('rate_limited');
  });

  it('classifies network errors', async () => {
    (complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const res = await POST(makeReq({ provider: 'deepseek', apiKey: 'sk-test' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('network_error');
  });

  it('classifies abort as network_error with timeout message', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    (complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(abortErr);

    const res = await POST(makeReq({ provider: 'google', apiKey: 'sk-test' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('network_error');
    expect(body.error).toBe('Request timed out');
  });

  it('accepts new providers like google and deepseek', async () => {
    (complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ text: 'ok' });

    const res = await POST(makeReq({ provider: 'google', apiKey: 'AI-key-test' }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(getModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
      apiKey: 'AI-key-test',
    }));
  });

  it('classifies explicit model missing errors as model_not_found', async () => {
    (complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Model not found: nonexistent-model does not exist'),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-test', model: 'nonexistent-model' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('model_not_found');
  });

  it('prioritizes model_not_found over generic 404 classification when the message is model-specific', async () => {
    (complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('404 Model not found: nonexistent-model does not exist'),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-test', model: 'nonexistent-model' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('model_not_found');
  });
});
