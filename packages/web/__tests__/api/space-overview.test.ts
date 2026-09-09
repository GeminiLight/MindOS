import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { invalidateCache } from '../../lib/fs';

// The POST half compiles with the Web LLM client and stays Web-only; the GET
// half is served by the shared route table against the real test mind root.
vi.mock('@/lib/compile', () => ({
  compileSpaceOverview: vi.fn().mockResolvedValue({
    content: '# Research\nA summary.',
    stats: { fileCount: 2, totalChars: 100, spaceName: 'Research' },
  }),
  isCompileError: vi.fn().mockReturnValue(false),
}));

const { GET, POST } = await import('@/app/api/space-overview/route');

describe('GET /api/space-overview', () => {
  it('returns 400 without space param', async () => {
    const req = new NextRequest('http://localhost/api/space-overview');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns file count for a seeded space', async () => {
    seedFile('Research/file1.md', '# File 1');
    seedFile('Research/file2.md', '# File 2');
    seedFile('Other/file3.md', '# not counted');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/space-overview?space=Research');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fileCount).toBe(2);
  });

  it('reports zero files for a space that does not exist', async () => {
    invalidateCache();
    const res = await GET(new NextRequest('http://localhost/api/space-overview?space=Missing'));
    expect(res.status).toBe(200);
    expect((await res.json()).fileCount).toBe(0);
  });
});

describe('POST /api/space-overview', () => {
  it('returns 400 without space field', async () => {
    const req = new NextRequest('http://localhost/api/space-overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns compile result for valid space', async () => {
    const req = new NextRequest('http://localhost/api/space-overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ space: 'Research' }),
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.stats.fileCount).toBe(2);
    expect(data.content).toContain('Research');
  });

  it('returns error for compile failures', async () => {
    const { compileSpaceOverview, isCompileError } = await import('@/lib/compile');
    (compileSpaceOverview as any).mockResolvedValueOnce({
      code: 'no_api_key',
      message: 'No AI API key configured.',
    });
    (isCompileError as any).mockReturnValueOnce(true);

    const req = new NextRequest('http://localhost/api/space-overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ space: 'Research' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('no_api_key');
  });
});
