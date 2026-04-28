import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/compile', () => ({
  collectSpaceFiles: vi.fn().mockReturnValue([
    { name: 'file1.md', preview: '# File 1' },
    { name: 'file2.md', preview: '# File 2' },
  ]),
  compileSpaceOverview: vi.fn().mockResolvedValue({
    content: '# Research\nA summary.',
    stats: { fileCount: 2, totalChars: 100, spaceName: 'Research' },
  }),
  isCompileError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/fs', () => ({
  getMindRoot: () => '/tmp/fake-mind-root',
}));

const { GET, POST } = await import('@/app/api/space-overview/route');

describe('GET /api/space-overview', () => {
  it('returns 400 without space param', async () => {
    const req = new NextRequest('http://localhost/api/space-overview');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns file count for valid space', async () => {
    const req = new NextRequest('http://localhost/api/space-overview?space=Research');
    const res = await GET(req);
    const data = await res.json();
    expect(data.fileCount).toBe(2);
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
