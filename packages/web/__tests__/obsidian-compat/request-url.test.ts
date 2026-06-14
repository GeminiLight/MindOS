import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, requestUrl } from '@/lib/obsidian-compat/shims/obsidian';

function arrayBufferFrom(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function stubFetchResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  const arrayBuffer = vi.fn(async () => arrayBufferFrom(body));
  const fetchMock = vi.fn(async () => ({
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    arrayBuffer,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, arrayBuffer };
}

describe('obsidian requestUrl shim', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an Obsidian-style response promise with convenience fields', async () => {
    const { fetchMock } = stubFetchResponse('{"ok":true}', {
      headers: { 'content-type': 'application/json', 'x-plugin': 'mindos' },
    });

    const responsePromise = requestUrl('https://example.com/api');

    await expect(responsePromise.text).resolves.toBe('{"ok":true}');
    await expect(responsePromise.json).resolves.toEqual({ ok: true });
    await expect(responsePromise.arrayBuffer).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(responsePromise).resolves.toMatchObject({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-plugin': 'mindos',
      },
      text: '{"ok":true}',
      json: { ok: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses request() as a text shortcut', async () => {
    stubFetchResponse('plain response');

    await expect(request('https://example.com/plain')).resolves.toBe('plain response');
  });

  it('passes method, content type, custom headers, and body to fetch', async () => {
    const { fetchMock } = stubFetchResponse('{"saved":true}');
    const body = arrayBufferFrom('payload');

    await requestUrl({
      url: 'https://example.com/post',
      method: 'POST',
      contentType: 'application/octet-stream',
      headers: { authorization: 'Bearer token' },
      body,
    });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/post', expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        authorization: 'Bearer token',
      },
      body,
      signal: expect.any(AbortSignal),
    }));
  });

  it('rejects HTTP error responses by default with response details', async () => {
    stubFetchResponse('{"error":"denied"}', {
      status: 403,
      headers: { 'x-denied': 'true' },
    });

    await expect(requestUrl('https://example.com/denied')).rejects.toMatchObject({
      name: 'RequestUrlError',
      status: 403,
      headers: { 'x-denied': 'true' },
      response: {
        status: 403,
        text: '{"error":"denied"}',
        json: { error: 'denied' },
      },
    });
  });

  it('returns HTTP error responses when throw is false', async () => {
    stubFetchResponse('not found', { status: 404 });

    await expect(requestUrl({ url: 'https://example.com/missing', throw: false })).resolves.toMatchObject({
      status: 404,
      text: 'not found',
      json: null,
    });
  });

  it('rejects non-http URLs before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = requestUrl('file:///tmp/secret.md');

    await expect(responsePromise).rejects.toThrow(/only supports http\/https URLs/);
    await expect(responsePromise.text).rejects.toThrow(/only supports http\/https URLs/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects local and private hosts before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestUrl('http://localhost:3000/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://127.0.0.1/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://192.168.1.10/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://[::1]/private')).rejects.toThrow(/local\/private hosts/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized responses before reading the body when content-length is known', async () => {
    const { fetchMock, arrayBuffer } = stubFetchResponse('too large', {
      headers: { 'content-length': String(6 * 1024 * 1024) },
    });

    await expect(requestUrl('https://example.com/large')).rejects.toThrow(/too large/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
