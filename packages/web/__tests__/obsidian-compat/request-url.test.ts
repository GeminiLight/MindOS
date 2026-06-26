import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObsidianRuntimeHost } from '@/lib/obsidian-compat/runtime';
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

  it('records called runtime ledger evidence for allowed requests', async () => {
    stubFetchResponse('{"ok":true}');
    const host = new ObsidianRuntimeHost();

    await host.runWithPluginContext('network-plugin', async () => {
      await expect(requestUrl('https://example.com/api')).resolves.toMatchObject({
        status: 200,
        json: { ok: true },
      });
    });

    expect(host.getRuntimeCapabilityLedger('network-plugin')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'requestUrl',
        surface: 'network',
        phase: 'called',
        source: 'runtime-ledger',
      }),
    ]));
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
      redirect: 'manual',
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

  it('rejects redirects to local and private hosts before reading the redirected body', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/redirect') {
        return {
          status: 302,
          headers: new Headers({ location: 'http://[::ffff:127.0.0.1]/private' }),
          arrayBuffer: vi.fn(),
        };
      }
      return {
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn(async () => arrayBufferFrom('should not be read')),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestUrl('https://example.com/redirect')).rejects.toThrow(/local\/private hosts/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/redirect', expect.objectContaining({
      redirect: 'manual',
    }));
  });

  it('follows safe redirects and reports the final response', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/redirect') {
        return {
          status: 302,
          headers: new Headers({ location: 'https://cdn.example.com/final' }),
          arrayBuffer: vi.fn(),
        };
      }
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        arrayBuffer: vi.fn(async () => arrayBufferFrom('redirected')),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestUrl('https://example.com/redirect')).resolves.toMatchObject({
      status: 200,
      text: 'redirected',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('https://cdn.example.com/final', expect.objectContaining({
      redirect: 'manual',
    }));
  });

  it('strips sensitive headers when following cross-origin redirects', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/redirect') {
        return {
          status: 302,
          headers: new Headers({ location: 'https://cdn.example.com/final' }),
          arrayBuffer: vi.fn(),
        };
      }
      return {
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn(async () => arrayBufferFrom('redirected')),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestUrl({
      url: 'https://example.com/redirect',
      headers: {
        authorization: 'Bearer secret',
        cookie: 'sid=secret',
        'x-api-key': 'secret',
        'x-safe-header': 'public',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://cdn.example.com/final', expect.objectContaining({
      headers: { 'x-safe-header': 'public' },
    }));
  });

  it('rejects local and private hosts before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestUrl('http://localhost:3000/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://127.0.0.1/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://100.64.0.1/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://192.168.1.10/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://198.18.0.1/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://[::1]/private')).rejects.toThrow(/local\/private hosts/);
    await expect(requestUrl('http://[::ffff:127.0.0.1]/private')).rejects.toThrow(/local\/private hosts/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records denied runtime ledger evidence for requestUrl policy rejections', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const host = new ObsidianRuntimeHost();

    await host.runWithPluginContext('network-plugin', async () => {
      await expect(requestUrl('http://localhost:3000/private')).rejects.toThrow(/local\/private hosts/);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.getRuntimeCapabilityLedger('network-plugin')).toEqual([
      expect.objectContaining({
        capability: 'requestUrl',
        surface: 'network',
        phase: 'denied',
        source: 'runtime-ledger',
        evidence: expect.stringContaining('local/private hosts'),
      }),
    ]);
  });

  it('rejects oversized responses before reading the body when content-length is known', async () => {
    const { fetchMock, arrayBuffer } = stubFetchResponse('too large', {
      headers: { 'content-length': String(6 * 1024 * 1024) },
    });
    const host = new ObsidianRuntimeHost();

    await host.runWithPluginContext('network-plugin', async () => {
      await expect(requestUrl('https://example.com/large')).rejects.toThrow(/too large/);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(host.getRuntimeCapabilityLedger('network-plugin')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'requestUrl',
        phase: 'called',
      }),
      expect.objectContaining({
        capability: 'requestUrl',
        phase: 'denied',
        evidence: expect.stringContaining('too large'),
      }),
    ]));
  });
});
