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

  it('returns JSON errors for invalid raw file requests', async () => {
    const req = new NextRequest('http://localhost/api/file/raw?path=notes/readme.md');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unsupported binary file type: .md' });
  });
});
