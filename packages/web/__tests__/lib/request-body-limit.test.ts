import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  isPayloadTooLarge,
  readJsonBodyWithLimit,
  RequestBodyError,
} from '@/lib/api/request-utils';

function streamRequest(chunks: string[], headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers,
    body,
    // Node's fetch implementation requires half-duplex for streaming bodies.
    ...({ duplex: 'half' } as Record<string, unknown>),
  });
}

function stringRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('readJsonBodyWithLimit', () => {
  it('parses a normal JSON body under the limit', async () => {
    await expect(readJsonBodyWithLimit(stringRequest('{"hello":"world"}'), 1024)).resolves.toEqual({ hello: 'world' });
  });

  it('accepts a body whose size equals the limit exactly', async () => {
    const body = '{"a":"bb"}';
    await expect(readJsonBodyWithLimit(stringRequest(body), Buffer.byteLength(body))).resolves.toEqual({ a: 'bb' });
  });

  it('rejects an oversized content-length before reading the body', async () => {
    const req = stringRequest('{"a":1}', { 'content-length': String(10 * 1024 * 1024) });

    const error = await readJsonBodyWithLimit(req, 1024).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestBodyError);
    expect((error as RequestBodyError).statusCode).toBe(413);
    expect(isPayloadTooLarge(error)).toBe(true);
    // The body must remain unconsumed so the caller can still drain/ignore it.
    expect(req.bodyUsed).toBe(false);
  });

  it('rejects an oversized streamed body that carries no content-length', async () => {
    const req = streamRequest(['{"payload":"', 'x'.repeat(600), 'y'.repeat(600), '"}']);
    expect(req.headers.get('content-length')).toBeNull();

    const error = await readJsonBodyWithLimit(req, 1000).catch((e: unknown) => e);

    expect(isPayloadTooLarge(error)).toBe(true);
    expect((error as RequestBodyError).statusCode).toBe(413);
  });

  it('counts multi-byte characters by their UTF-8 byte length', async () => {
    const body = JSON.stringify({ text: '🔐'.repeat(100) }); // 4 bytes per emoji
    const bytes = Buffer.byteLength(body);

    await expect(readJsonBodyWithLimit(streamRequest([body]), bytes)).resolves.toEqual({ text: '🔐'.repeat(100) });
    await expect(readJsonBodyWithLimit(streamRequest([body]), bytes - 1)).rejects.toMatchObject({ statusCode: 413 });
  });

  it('reports invalid JSON as a 400-shaped error', async () => {
    const error = await readJsonBodyWithLimit(stringRequest('{broken'), 1024).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestBodyError);
    expect((error as RequestBodyError).statusCode).toBe(400);
    expect(isPayloadTooLarge(error)).toBe(false);
  });

  it('reports an empty body as a 400-shaped error', async () => {
    const req = new NextRequest('http://localhost/api/test', { method: 'POST' });

    await expect(readJsonBodyWithLimit(req, 1024)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('ignores a malformed content-length header and falls back to counting bytes', async () => {
    await expect(readJsonBodyWithLimit(stringRequest('{"ok":true}', { 'content-length': 'abc' }), 1024)).resolves.toEqual({ ok: true });
  });
});
