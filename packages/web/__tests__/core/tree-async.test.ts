import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { collectAllFiles } from '@/lib/core/tree';
import { collectAllFilesAsync } from '@/lib/core/tree';
import fs from 'fs';
import path from 'path';

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

  it('does not collect files from a symlinked start directory outside root', async () => {
    const outsideRoot = fs.mkdtempSync(path.join(path.dirname(mindRoot), 'mindos-tree-async-outside-'));
    try {
      fs.writeFileSync(path.join(outsideRoot, 'leak.md'), 'outside', 'utf-8');
      fs.symlinkSync(outsideRoot, path.join(mindRoot, 'linked-outside'), 'dir');

      await expect(collectAllFilesAsync(mindRoot, path.join(mindRoot, 'linked-outside'))).resolves.toEqual([]);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
