import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/file/import/route';
import { getTestMindRoot } from '../setup';

function importRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/file/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/file/import', () => {
  it('rejects invalid base64 uploads without creating damaged files', async () => {
    const mindRoot = getTestMindRoot();

    const res = await POST(importRequest({
      files: [{ name: 'broken.pdf', content: 'not base64!!!', encoding: 'base64' }],
      organize: false,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.created).toEqual([]);
    expect(body.errors).toEqual([
      expect.objectContaining({ name: 'broken.pdf', error: expect.stringContaining('Invalid base64 content') }),
    ]);
    expect(fs.existsSync(path.join(mindRoot, 'broken.pdf'))).toBe(false);
  });

  it('rejects imports into a symlinked target space outside mindRoot', async () => {
    const mindRoot = getTestMindRoot();
    const outsideRoot = `${mindRoot}-outside`;
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.symlinkSync(outsideRoot, path.join(mindRoot, 'Linked'), 'dir');

    try {
      const res = await POST(importRequest({
        targetSpace: 'Linked',
        files: [{ name: 'leak.md', content: '# outside' }],
      }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.created).toEqual([]);
      expect(body.errors).toEqual([
        expect.objectContaining({ name: 'leak.md', error: expect.stringContaining('Access denied') }),
      ]);
      expect(fs.existsSync(path.join(outsideRoot, 'leak.md'))).toBe(false);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
