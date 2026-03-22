import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test apiFetch which uses global fetch — mock it
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { apiFetch, ApiError } from '@/lib/api';

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

describe('ApiError', () => {
  it('has correct name and status', () => {
    const err = new ApiError('Not Found', 404);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('Not Found');
    expect(err.status).toBe(404);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: 'hello' }),
    });
    const result = await apiFetch<{ data: string }>('/api/test');
    expect(result).toEqual({ data: 'hello' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws ApiError with error body on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden resource' }),
    });
    await expect(apiFetch('/api/test')).rejects.toThrow(ApiError);
    try {
      await apiFetch('/api/test');
    } catch (e) {
      // mockFetch already consumed, re-mock for second call
    }
    // Re-test with fresh mock
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden resource' }),
    });
    try {
      await apiFetch('/api/test');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).message).toBe('Forbidden resource');
    }
  });

  it('throws ApiError with generic message when error body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    });
    try {
      await apiFetch('/api/test');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).message).toContain('500');
    }
  });

  it('throws ApiError with generic message when error body has no error field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'something' }),
    });
    try {
      await apiFetch('/api/test');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).message).toContain('422');
    }
  });

  it('passes fetch options through', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    await apiFetch('/api/test', {
      method: 'POST',
      headers: { 'X-Custom': 'value' },
      body: JSON.stringify({ key: 'val' }),
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/test');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ 'X-Custom': 'value' });
  });

  it('works with timeout disabled (timeout=0)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const result = await apiFetch('/api/test', { timeout: 0 });
    expect(result).toEqual({ ok: true });
    // signal should be undefined when timeout=0 and no external signal
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.signal).toBeUndefined();
  });

  it('passes external signal when provided', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await apiFetch('/api/test', { timeout: 0, signal: controller.signal });
    const [, opts] = mockFetch.mock.calls[0];
    // With signal bridging, fetch receives a new controller's signal (not the original)
    // but aborting the original should propagate — verify signal exists
    expect(opts.signal).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
