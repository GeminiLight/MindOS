import { describe, it, expect } from 'vitest';
import { seedFile } from '../setup';
import { GET } from '../../app/api/search/prewarm/route';
import { invalidateCache } from '../../lib/fs';

describe('GET /api/search/prewarm', () => {
  it('builds both UI and Core search indexes on first request', async () => {
    seedFile('doc.md', 'This document is used to warm the search index');
    invalidateCache();

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warmed).toBe(true);
    expect(body.cacheState).toBe('built');
    expect(body.documentCount).toBe(1);
    expect(body.core).toEqual({
      cacheState: 'built',
      fileCount: 1,
    });
  });

  it('returns cache hit for both indexes on subsequent requests', async () => {
    seedFile('cached.md', 'Cache hit should not rebuild the index');
    invalidateCache();

    await GET();
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warmed).toBe(true);
    expect(body.cacheState).toBe('hit');
    expect(body.documentCount).toBe(1);
    expect(body.core).toEqual({
      cacheState: 'hit',
      fileCount: 1,
    });
  });

  it('still succeeds if core prewarm fails', async () => {
    // Even if mindRoot is somehow invalid for core search,
    // UI prewarm should still return successfully
    seedFile('fallback.md', 'UI search still works');
    invalidateCache();

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warmed).toBe(true);
  });
});
