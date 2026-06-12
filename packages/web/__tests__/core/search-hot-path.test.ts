/**
 * P0 regression tests: warm searches must be served from the in-memory index.
 *
 * Before the fix, every query re-walked the whole library (recursive
 * readdirSync via collectAllFiles) and re-read the full text of every
 * candidate file from disk, lowercasing it twice.
 */
import fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { searchFiles } from '@/lib/core/search';

describe('search hot path', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    seedFile(mindRoot, 'Profile/Identity.md', '# Identity\n\nI am a developer working on MindOS.');
    seedFile(mindRoot, 'Projects/TODO.md', '# TODO\n\n- Fix the bug\n- Add search feature');
    seedFile(mindRoot, 'Archive/old.md', 'This is archived content about search.');
    seedFile(mindRoot, 'Resources/data.csv', 'name,value\nfoo,bar');
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
    vi.restoreAllMocks();
  });

  it('does not re-scan the library directory tree on warm queries', () => {
    searchFiles(mindRoot, 'search'); // cold: builds the index
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    const results = searchFiles(mindRoot, 'search');
    expect(results.length).toBeGreaterThan(0);
    expect(readdirSpy).not.toHaveBeenCalled();
  });

  it('does not re-read file contents from disk on warm queries', () => {
    searchFiles(mindRoot, 'search'); // cold: builds the index + content cache
    const readFileSpy = vi.spyOn(fs, 'readFileSync');
    const results = searchFiles(mindRoot, 'developer');
    expect(results.length).toBeGreaterThan(0);
    const libraryReads = readFileSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith(mindRoot),
    );
    expect(libraryReads).toHaveLength(0);
  });

  it('returns identical results on cold and warm queries', () => {
    const cold = searchFiles(mindRoot, 'search');
    const warm = searchFiles(mindRoot, 'search');
    expect(warm).toEqual(cold);
  });

  it('still answers single-character queries that bypass the inverted index', () => {
    seedFile(mindRoot, 'Notes/single.md', 'a b c');
    const first = searchFiles(mindRoot, 'a');
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    const second = searchFiles(mindRoot, 'a');
    expect(second).toEqual(first);
    expect(readdirSpy).not.toHaveBeenCalled();
  });

  it('still honors modified_after filtering on warm queries', () => {
    searchFiles(mindRoot, 'search');
    const results = searchFiles(mindRoot, 'search', { modified_after: '2099-01-01T00:00:00Z' });
    expect(results).toEqual([]);
  });

  it('still honors scope and file_type filters on warm queries', () => {
    searchFiles(mindRoot, 'search');
    const scoped = searchFiles(mindRoot, 'search', { scope: 'Projects/' });
    expect(scoped.every((r) => r.path.startsWith('Projects/'))).toBe(true);
    const typed = searchFiles(mindRoot, 'foo', { file_type: 'csv' });
    expect(typed.map((r) => r.path)).toEqual(['Resources/data.csv']);
  });
});
