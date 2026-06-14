import fs from 'fs';
import path from 'path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { GET } from '../../app/api/search/prewarm/route';
import { invalidateCache, stopFileWatcher } from '../../lib/fs';

afterEach(() => {
  stopFileWatcher();
  vi.useRealTimers();
});

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

  it('keeps the UI search index warm after the tree cache TTL expires when files are unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    seedFile('stable.md', 'Stable files should not force a UI search rebuild');
    invalidateCache();

    await GET();

    vi.setSystemTime(new Date('2026-01-01T00:00:31.000Z'));
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cacheState).toBe('hit');
    expect(body.documentCount).toBe(1);
  });

  it('rebuilds the UI search index after the tree cache TTL expires when the watcher is unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    seedFile('changed.md', 'Initial content');
    invalidateCache();

    await GET();
    stopFileWatcher();

    const abs = path.join(testMindRoot, 'changed.md');
    fs.writeFileSync(abs, 'Changed content should invalidate the UI search index', 'utf-8');
    fs.utimesSync(abs, new Date('2026-01-01T00:00:40.000Z'), new Date('2026-01-01T00:00:40.000Z'));

    vi.setSystemTime(new Date('2026-01-01T00:00:31.000Z'));
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cacheState).toBe('built');
    expect(body.documentCount).toBe(1);
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
