import { describe, expect, it } from 'vitest';
import { HttpBodyError, KNOWLEDGE_WRITE_MAX_BODY_BYTES, MINDOS_DEFAULT_JSON_BODY_LIMIT, readJsonBody } from './body.js';

function request(body: string | null, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/x', { method: 'POST', body, headers });
}

async function status(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof HttpBodyError ? error.status : -1;
  }
}

describe('readJsonBody', () => {
  it('parses JSON, treats an empty body as {} and rejects invalid JSON with 400', async () => {
    await expect(readJsonBody(request('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJsonBody(request(null))).resolves.toEqual({});
    await expect(readJsonBody(request('   '))).resolves.toEqual({});
    expect(await status(readJsonBody(request('{broken')))).toBe(400);
  });

  it('rejects a declared content-length above the limit before reading the stream', async () => {
    const tiny = request('{"files":[]}', { 'content-length': String(MINDOS_DEFAULT_JSON_BODY_LIMIT + 1) });
    expect(await status(readJsonBody(tiny))).toBe(413);
  });

  it('ignores malformed or negative content-length headers and falls back to streaming', async () => {
    await expect(readJsonBody(request('{"ok":true}', { 'content-length': 'abc' }))).resolves.toEqual({ ok: true });
    await expect(readJsonBody(request('{"ok":true}', { 'content-length': '-5' }))).resolves.toEqual({ ok: true });
  });

  it('rejects streamed bodies that exceed the limit even without content-length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"x":"'));
        controller.enqueue(new TextEncoder().encode('y'.repeat(64)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const req = new Request('http://localhost/api/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await status(readJsonBody(req, 32))).toBe(413);
  });

  it('publishes the knowledge write limit shared by /api/file and /api/inbox', () => {
    expect(KNOWLEDGE_WRITE_MAX_BODY_BYTES).toBe(25 * 1024 * 1024);
    expect(KNOWLEDGE_WRITE_MAX_BODY_BYTES).toBeGreaterThan(MINDOS_DEFAULT_JSON_BODY_LIMIT);
  });
});
