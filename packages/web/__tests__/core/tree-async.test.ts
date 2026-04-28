import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { collectAllFiles } from '@/lib/core/tree';
import { collectAllFilesAsync } from '@/lib/core/tree';

describe('collectAllFilesAsync', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
  });

  it('returns same results as sync version', async () => {
    seedFile(mindRoot, 'a.md', '# A');
    seedFile(mindRoot, 'dir/b.md', '# B');
    seedFile(mindRoot, 'dir/c.csv', 'col1,col2');
    seedFile(mindRoot, 'ignored.txt', 'skip');

    const syncResult = collectAllFiles(mindRoot).sort();
    const asyncResult = (await collectAllFilesAsync(mindRoot)).sort();
    expect(asyncResult).toEqual(syncResult);
  });

  it('handles empty directory', async () => {
    const result = await collectAllFilesAsync(mindRoot);
    expect(result).toEqual([]);
  });

  it('handles non-existent directory', async () => {
    const result = await collectAllFilesAsync('/nonexistent/path');
    expect(result).toEqual([]);
  });

  it('handles deep nesting', async () => {
    seedFile(mindRoot, 'a/b/c/d.md', 'deep');
    const result = await collectAllFilesAsync(mindRoot);
    expect(result).toContain('a/b/c/d.md');
  });
});
