import { closeSync, mkdtempSync, openSync, rmSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_RAW_FILE_SIZE,
  RAW_FILE_STREAM_THRESHOLD,
  getOpenRawFileHandleCountForTests,
  handleRawFile,
} from './file-raw.js';
import { toWebResponse } from '../web-response.js';
import { createDefaultMindosHttpServices, createMindosHttpServer } from '../http.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  expect(getOpenRawFileHandleCountForTests()).toBe(0);
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mindos-raw-stream-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A sparse file of `size` bytes: no data is written, the filesystem reports zeros. */
function sparseFile(root: string, name: string, size: number): string {
  const file = join(root, name);
  closeSync(openSync(file, 'w'));
  truncateSync(file, size);
  return file;
}

function isStream(body: unknown): body is ReadableStream<Uint8Array> {
  return body instanceof ReadableStream;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<{ bytes: number; chunks: number }> {
  const reader = stream.getReader();
  let bytes = 0;
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    chunks += 1;
  }
  return { bytes, chunks };
}

async function settle(): Promise<void> {
  // Handle close is asynchronous; give the promise chain a tick.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

const LARGE = RAW_FILE_STREAM_THRESHOLD + 64 * 1024 + 17;

describe('handleRawFile streaming', () => {
  it('keeps small files as an in-memory Buffer with an ETag', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'clip.mp3'), Buffer.from('abcdef'));
    const res = handleRawFile(new URLSearchParams('path=clip.mp3'), { mindRoot: root });
    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.headers?.ETag).toMatch(/^W\/"6-\d+"$/);
    expect(res.headers).toMatchObject({ 'Content-Length': '6', 'Accept-Ranges': 'bytes' });
  });

  it('streams files above the threshold without buffering them', async () => {
    const root = makeRoot();
    sparseFile(root, 'movie.mp4', LARGE);
    const res = handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root });
    expect(res.status).toBe(200);
    expect(isStream(res.body)).toBe(true);
    expect(res.headers).toMatchObject({
      'Content-Type': 'video/mp4',
      'Content-Length': String(LARGE),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=60',
    });
    expect(res.headers?.ETag).toMatch(/^W\/"\d+-\d+"$/);
    expect(getOpenRawFileHandleCountForTests()).toBe(1);

    const { bytes, chunks } = await drain(res.body as ReadableStream<Uint8Array>);
    expect(bytes).toBe(LARGE);
    expect(chunks).toBeGreaterThan(1);
    await settle();
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('streams a Range as 206 with exactly the requested bytes', async () => {
    const root = makeRoot();
    const file = sparseFile(root, 'clip.wav', LARGE);
    // Stamp a marker so the range is verifiably positional, not just zeros.
    const start = 100;
    const fd = openSync(file, 'r+');
    try {
      const marker = Buffer.from('MARK');
      writeSync(fd, marker, 0, marker.length, start);
    } finally {
      closeSync(fd);
    }
    const end = LARGE - 1;
    expect(end - start + 1).toBeGreaterThan(RAW_FILE_STREAM_THRESHOLD);
    const res = handleRawFile(new URLSearchParams('path=clip.wav'), { mindRoot: root }, { range: `bytes=${start}-` });
    expect(res.status).toBe(206);
    expect(isStream(res.body)).toBe(true);
    expect(res.headers).toMatchObject({
      'Content-Range': `bytes ${start}-${end}/${LARGE}`,
      'Content-Length': String(end - start + 1),
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!.subarray(0, 4)).toString()).toBe('MARK');
    let bytes = first.value!.byteLength;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
    expect(bytes).toBe(end - start + 1);
    await settle();
  });

  it('answers a short Range of a large file from memory (no descriptor left open)', () => {
    const root = makeRoot();
    sparseFile(root, 'clip.wav', LARGE);
    const res = handleRawFile(new URLSearchParams('path=clip.wav'), { mindRoot: root }, { range: 'bytes=10-1033' });
    expect(res.status).toBe(206);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).byteLength).toBe(1024);
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('still answers 416 for unsatisfiable ranges on large files without opening them', () => {
    const root = makeRoot();
    sparseFile(root, 'clip.wav', LARGE);
    const res = handleRawFile(new URLSearchParams('path=clip.wav'), { mindRoot: root }, { range: `bytes=${LARGE}-` });
    expect(res.status).toBe(416);
    expect(res.headers).toMatchObject({ 'Content-Range': `bytes */${LARGE}` });
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('answers 304 to a matching If-None-Match without opening the file', () => {
    const root = makeRoot();
    sparseFile(root, 'movie.mp4', LARGE);
    const first = handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root });
    const etag = first.headers?.ETag as string;
    void (first.body as ReadableStream<Uint8Array>).cancel();
    const res = handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root }, { ifNoneMatch: etag });
    expect(res.status).toBe(304);
    expect(res.body).toBeUndefined();
    expect(res.headers).toMatchObject({ ETag: etag, 'Cache-Control': 'private, max-age=60' });
    const weak = handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root }, { ifNoneMatch: `"other", ${etag}` });
    expect(weak.status).toBe(304);
    const stale = handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root }, { ifNoneMatch: 'W/"1-1"' });
    expect(stale.status).toBe(200);
    void (stale.body as ReadableStream<Uint8Array>).cancel();
  });

  it('closes the file descriptor when the consumer cancels mid-stream', async () => {
    const root = makeRoot();
    sparseFile(root, 'movie.mp4', LARGE);
    const res = handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(getOpenRawFileHandleCountForTests()).toBe(1);
    await reader.cancel();
    await settle();
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('closes the file descriptor when the request aborts before the body is consumed', async () => {
    const root = makeRoot();
    sparseFile(root, 'movie.mp4', LARGE);
    const controller = new AbortController();
    const request = new Request('http://localhost/api/file/raw?path=movie.mp4', { signal: controller.signal });
    const res = toWebResponse(handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root }), { request });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-length')).toBe(String(LARGE));
    expect(getOpenRawFileHandleCountForTests()).toBe(1);
    controller.abort();
    await settle();
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('closes the file descriptor when the response consumer cancels its reader (client disconnect)', async () => {
    const root = makeRoot();
    sparseFile(root, 'movie.mp4', LARGE);
    const request = new Request('http://localhost/api/file/raw?path=movie.mp4');
    const res = toWebResponse(handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root }), { request });
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();
    await settle();
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('cancels a stream body that toWebResponse short-circuits into 304', async () => {
    const root = makeRoot();
    sparseFile(root, 'movie.mp4', LARGE);
    const probe = handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root });
    const etag = probe.headers?.ETag as string;
    void (probe.body as ReadableStream<Uint8Array>).cancel();
    // A host that forgot to pass ifNoneMatch to the handler still must not leak.
    const request = new Request('http://localhost/api/file/raw?path=movie.mp4', { headers: { 'if-none-match': etag } });
    const res = toWebResponse(handleRawFile(new URLSearchParams('path=movie.mp4'), { mindRoot: root }), { request });
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
    await settle();
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('keeps the SVG sandbox CSP and nosniff on streamed SVGs', async () => {
    const root = makeRoot();
    sparseFile(root, 'huge.svg', LARGE);
    const res = handleRawFile(new URLSearchParams('path=huge.svg'), { mindRoot: root });
    expect(isStream(res.body)).toBe(true);
    expect(res.headers).toMatchObject({
      'Content-Type': 'image/svg+xml',
      'Content-Security-Policy': "sandbox; script-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    await (res.body as ReadableStream<Uint8Array>).cancel();
    await settle();
  });

  it('refuses files over the cap without opening them', () => {
    const root = makeRoot();
    sparseFile(root, 'giant.mp4', MAX_RAW_FILE_SIZE + 1);
    const res = handleRawFile(new URLSearchParams('path=giant.mp4'), { mindRoot: root });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: expect.stringContaining('File too large') });
    expect(getOpenRawFileHandleCountForTests()).toBe(0);
  });

  it('serves large files, ranges and 304s over HTTP through the Product Server', async () => {
    const root = makeRoot();
    sparseFile(root, 'movie.mp4', LARGE);
    const services = createDefaultMindosHttpServices({ homeDir: root, readSettings: () => ({ mindRoot: root }) });
    cleanups.push(() => services.dispose?.());
    const app = createMindosHttpServer({ hostname: '127.0.0.1', port: 0, services });
    await app.listen();
    cleanups.push(() => app.close());
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;

    const full = await fetch(`${base}/api/file/raw?path=movie.mp4`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe(String(LARGE));
    expect((await full.arrayBuffer()).byteLength).toBe(LARGE);
    const etag = full.headers.get('etag');
    expect(etag).toMatch(/^W\/"\d+-\d+"$/);

    const partial = await fetch(`${base}/api/file/raw?path=movie.mp4`, { headers: { range: 'bytes=10-1033' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 10-1033/${LARGE}`);
    expect((await partial.arrayBuffer()).byteLength).toBe(1024);

    const cached = await fetch(`${base}/api/file/raw?path=movie.mp4`, { headers: { 'if-none-match': etag! } });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    await settle();
  });
});
