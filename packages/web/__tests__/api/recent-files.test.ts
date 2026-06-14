import fs from 'fs';
import { describe, it, expect, vi } from 'vitest';
import { seedFile } from '../setup';
import { GET } from '@/app/api/recent-files/route';
import { invalidateCache } from '@/lib/fs';
import { NextRequest } from 'next/server';

function makeRequest(limit?: string) {
  const url = new URL('http://localhost/api/recent-files');
  if (limit) url.searchParams.set('limit', limit);
  return new NextRequest(url);
}

describe('GET /api/recent-files', () => {
  it('returns empty when no files exist', async () => {
    invalidateCache();
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it('returns recently modified files sorted by mtime', async () => {
    seedFile('old.md', 'old');
    // small delay to ensure different mtime
    await new Promise(r => setTimeout(r, 50));
    seedFile('new.md', 'new');
    invalidateCache();
    const res = await GET(makeRequest());
    const json: Array<{ path: string }> = await res.json();
    expect(json.length).toBe(2);
    // newest first
    expect(json[0].path).toBe('new.md');
  });

  it('respects limit param', async () => {
    seedFile('a.md', 'a');
    seedFile('b.md', 'b');
    seedFile('c.md', 'c');
    invalidateCache();
    const res = await GET(makeRequest('2'));
    const json = await res.json();
    expect(json.length).toBe(2);
  });

  it('serves repeated recent-file reads from the tree cache without re-statting every file', async () => {
    seedFile('a.md', 'a');
    seedFile('b.md', 'b');
    invalidateCache();

    await GET(makeRequest('1'));

    const statSpy = vi.spyOn(fs, 'statSync');
    try {
      const res = await GET(makeRequest('1'));
      const json: Array<{ path: string }> = await res.json();

      expect(json.length).toBe(1);
      expect(statSpy).not.toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
    }
  });
});
