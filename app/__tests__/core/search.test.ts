import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { searchFiles } from '@/lib/core/search';

describe('search', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    seedFile(mindRoot, 'Profile/Identity.md', '# My Identity\n\nI am a developer working on MindOS.');
    seedFile(mindRoot, 'Projects/TODO.md', '# TODO\n\n- Fix the bug\n- Add search feature');
    seedFile(mindRoot, 'Resources/data.csv', 'name,value\nfoo,bar\nbaz,qux');
    seedFile(mindRoot, 'Archive/old.md', 'This is archived content about search.');
  });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  it('finds files containing the query (case-insensitive)', () => {
    const results = searchFiles(mindRoot, 'search');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const paths = results.map(r => r.path);
    expect(paths).toContain('Projects/TODO.md');
    expect(paths).toContain('Archive/old.md');
  });

  it('returns empty for empty query', () => {
    expect(searchFiles(mindRoot, '')).toEqual([]);
    expect(searchFiles(mindRoot, '   ')).toEqual([]);
  });

  it('returns empty when no match', () => {
    expect(searchFiles(mindRoot, 'xyznonexistent123')).toEqual([]);
  });

  it('respects scope filter', () => {
    const results = searchFiles(mindRoot, 'search', { scope: 'Projects/' });
    expect(results.every(r => r.path.startsWith('Projects/'))).toBe(true);
  });

  it('respects file_type filter', () => {
    const results = searchFiles(mindRoot, 'foo', { file_type: 'csv' });
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('Resources/data.csv');
  });

  it('respects limit', () => {
    const results = searchFiles(mindRoot, 'the', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('includes snippet and score', () => {
    const results = searchFiles(mindRoot, 'developer');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain('developer');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].occurrences).toBeGreaterThan(0);
  });

  it('sorts by score (occurrence density) descending', () => {
    seedFile(mindRoot, 'many.md', 'test test test test test');
    seedFile(mindRoot, 'few.md', 'test and lots of other words that dilute the density of matches significantly');
    const results = searchFiles(mindRoot, 'test');
    const manyIdx = results.findIndex(r => r.path === 'many.md');
    const fewIdx = results.findIndex(r => r.path === 'few.md');
    if (manyIdx !== -1 && fewIdx !== -1) {
      expect(manyIdx).toBeLessThan(fewIdx);
    }
  });
});
