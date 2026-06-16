import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { searchFiles } from '@/lib/core/search';
import { writeMindosIgnoreFile } from '@/lib/core/tree';

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

  it('does not search dependency, build, cache, or agent worktree directories', () => {
    seedFile(mindRoot, 'node_modules/pkg/index.md', 'private dependency needle');
    seedFile(mindRoot, 'dist/generated.md', 'generated needle');
    seedFile(mindRoot, 'coverage/report.md', 'coverage needle');
    seedFile(mindRoot, '.turbo/cache.md', 'cache needle');
    seedFile(mindRoot, '.cc-branch/branch.md', 'branch needle');
    seedFile(mindRoot, '.claude/worktrees/task/note.md', 'agent worktree needle');
    seedFile(mindRoot, 'Visible/real.md', 'visible needle');

    const paths = searchFiles(mindRoot, 'needle').map((result) => result.path);

    expect(paths).toContain('Visible/real.md');
    expect(paths.some((filePath) => filePath.includes('node_modules'))).toBe(false);
    expect(paths.some((filePath) => filePath.startsWith('dist/'))).toBe(false);
    expect(paths.some((filePath) => filePath.startsWith('coverage/'))).toBe(false);
    expect(paths.some((filePath) => filePath.startsWith('.turbo/'))).toBe(false);
    expect(paths.some((filePath) => filePath.startsWith('.cc-branch/'))).toBe(false);
    expect(paths.some((filePath) => filePath.startsWith('.claude/'))).toBe(false);
  });

  it('does not search paths ignored by .mindosignore', () => {
    writeMindosIgnoreFile(mindRoot, ['Archive/', 'Private Notes']);
    seedFile(mindRoot, 'Private Notes/secret.md', 'private needle');
    seedFile(mindRoot, 'Visible/real.md', 'visible needle');

    const paths = searchFiles(mindRoot, 'needle').map((result) => result.path);

    expect(paths).toContain('Visible/real.md');
    expect(paths).not.toContain('Archive/old.md');
    expect(paths).not.toContain('Private Notes/secret.md');
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

  it('scores tokenized CJK matches even when the query has no whitespace', () => {
    seedFile(mindRoot, 'Notes/cjk.md', '知识体系需要管理流程支持');

    const results = searchFiles(mindRoot, '知识管理');

    expect(results.map((r) => r.path)).toContain('Notes/cjk.md');
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
