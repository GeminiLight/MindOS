import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/settings/test-key/route';

// setup.ts already mocks @/lib/settings with effectiveAiConfig returning empty keys

const originalFetch = global.fetch;

beforeEach(() => {
  // Reset fetch mock before each test
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function makeReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/settings/test-key', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/settings/test-key', () => {
  // ─── Validation ──────────────────────────────────────────────

  it('rejects invalid provider', async () => {
    const res = await POST(makeReq({ provider: 'gemini', apiKey: 'test' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Invalid provider');
  });

  it('returns auth_error when no key configured', async () => {
    // effectiveAiConfig returns empty keys, and we pass no apiKey
    const res = await POST(makeReq({ provider: 'anthropic' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('auth_error');
    expect(body.error).toBe('No API key configured');
  });

  it('returns auth_error for openai when no key configured', async () => {
    const res = await POST(makeReq({ provider: 'openai' }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('auth_error');
  });

  // ─── Anthropic success ───────────────────────────────────────

  it('returns ok with latency on successful anthropic test', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.latency).toBeTypeOf('number');

    // Verify fetch was called with correct Anthropic endpoint and headers
    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
  });

  // ─── OpenAI success ──────────────────────────────────────────

  it('returns ok on successful openai test', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );

    const res = await POST(makeReq({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4' }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.latency).toBeTypeOf('number');

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer sk-test');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('uses custom baseUrl for openai', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );

    await POST(makeReq({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5.4',
      baseUrl: 'https://custom.api.com/v1/',
    }));

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://custom.api.com/v1/chat/completions');
  });

  it('returns incompatibility error when tool-call check fails for openai', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'tools is not supported' } }), { status: 400 }),
    );

    const res = await POST(makeReq({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-5.4' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.error).toContain('incompatible with agent tool calls');
  });

  // ─── Error classification ────────────────────────────────────

  it('classifies 401 as auth_error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{"error":"invalid_api_key"}', { status: 401 }),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'bad-key' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('auth_error');
  });

  it('classifies 403 as auth_error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 403 }),
    );

    const res = await POST(makeReq({ provider: 'openai', apiKey: 'bad-key' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('auth_error');
  });

  it('classifies 404 as model_not_found', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 404 }),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'nonexistent' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('model_not_found');
  });

  it('classifies 429 as rate_limited', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{}', { status: 429 }),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-ant-test' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('rate_limited');
  });

  it('extracts error message from JSON response body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 500 }),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-ant-test' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('unknown');
    expect(body.error).toBe('Quota exceeded');
  });

  // ─── Network errors ──────────────────────────────────────────

  it('classifies fetch rejection as network_error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-ant-test' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('network_error');
    expect(body.error).toBe('ECONNREFUSED');
  });

  it('classifies abort as network_error with timeout message', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(abortErr);

    const res = await POST(makeReq({ provider: 'anthropic', apiKey: 'sk-ant-test' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.code).toBe('network_error');
    expect(body.error).toBe('Request timed out');
  });

  // ─── Masked key fallback ─────────────────────────────────────

  it('treats ***set*** as masked and falls back to config (which is empty → auth_error)', async () => {
    const res = await POST(makeReq({ provider: 'anthropic', apiKey: '***set***' }));
    const body = await res.json();

    // effectiveAiConfig returns empty anthropicApiKey → auth_error
    expect(body.ok).toBe(false);
    expect(body.code).toBe('auth_error');
    expect(body.error).toBe('No API key configured');
  });
});
