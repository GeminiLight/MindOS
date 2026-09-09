import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { getTestMindRoot } from '../setup';
import { GET } from '../../app/api/file/raw/route';

function writeBinary(relativePath: string, content: Buffer) {
  const abs = path.join(getTestMindRoot(), relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('GET /api/file/raw', () => {
  it('serves binary files through the product server handler', async () => {
    writeBinary('media/sample.mp3', Buffer.from('abcdef'));

    const req = new NextRequest('http://localhost/api/file/raw?path=media/sample.mp3');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('abcdef');
  });

  it('supports range requests', async () => {
    writeBinary('media/sample.mp3', Buffer.from('abcdef'));

    const req = new NextRequest('http://localhost/api/file/raw?path=media/sample.mp3', {
      headers: { range: 'bytes=2-4' },
    });
    const res = await GET(req);

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-4/6');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('cde');
  });

  it('answers 304 to a matching If-None-Match through the delegated route', async () => {
    writeBinary('media/sample.mp3', Buffer.from('abcdef'));

    const first = await GET(new NextRequest('http://localhost/api/file/raw?path=media/sample.mp3'));
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const cached = await GET(new NextRequest('http://localhost/api/file/raw?path=media/sample.mp3', {
      headers: { 'if-none-match': etag! },
    }));
    expect(cached.status).toBe(304);
    expect(cached.headers.get('etag')).toBe(etag);
    expect(await cached.text()).toBe('');

    const stale = await GET(new NextRequest('http://localhost/api/file/raw?path=media/sample.mp3', {
      headers: { 'if-none-match': '"deadbeef"' },
    }));
    expect(stale.status).toBe(200);
  });

  it('streams files above the in-memory threshold with the full body intact', async () => {
    const large = Buffer.alloc(1_100_000, 0x61);
    writeBinary('media/large.mp3', large);

    const res = await GET(new NextRequest('http://localhost/api/file/raw?path=media/large.mp3'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(large.length));
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(large.length);
    expect(body.equals(large)).toBe(true);
  });

  it('returns JSON errors for invalid raw file requests', async () => {
    const req = new NextRequest('http://localhost/api/file/raw?path=notes/readme.md');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unsupported binary file type: .md' });
  });
});
