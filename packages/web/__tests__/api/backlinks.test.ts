import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { GET } from '../../app/api/backlinks/route';
import { invalidateCache } from '../../lib/fs';

describe('GET /api/backlinks', () => {
  it('returns error when path is missing', async () => {
    const req = new NextRequest('http://localhost/api/backlinks');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('path required');
  });

  it('finds wikilink backlinks', async () => {
    seedFile('target.md', '# Target');
    seedFile('source.md', 'See [[target]] for details');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/backlinks?path=target.md');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const results = await res.json();

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].filePath).toBe('source.md');
    expect(results[0].snippets.length).toBeGreaterThan(0);
  });

  it('finds markdown link backlinks', async () => {
    seedFile('target.md', '# Target');
    seedFile('linker.md', 'Check [this](target.md) out');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/backlinks?path=target.md');
    const res = await GET(req);
    const results = await res.json();

    expect(results.length).toBeGreaterThanOrEqual(1);
    const paths = results.map((r: { filePath: string }) => r.filePath);
    expect(paths).toContain('linker.md');
  });

  it('returns empty when no backlinks exist', async () => {
    seedFile('alone.md', '# No links here');
    seedFile('other.md', '# Other page');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/backlinks?path=alone.md');
    const res = await GET(req);
    const results = await res.json();
    expect(results).toEqual([]);
  });
});
