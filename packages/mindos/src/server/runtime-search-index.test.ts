import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prewarmRuntimeSearch, searchMindRoot } from './runtime.js';

function writeWithMtime(path: string, content: string, mtimeSeconds: number) {
  writeFileSync(path, content, 'utf-8');
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}

describe('runtime search index freshness', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-search-index-'));
    writeWithMtime(join(root, 'a.md'), 'alpha one', 1_700_000_000);
    writeWithMtime(join(root, 'b.md'), 'beta two', 1_700_000_000);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('re-indexes only changed files and drops deleted ones', async () => {
    expect((await searchMindRoot(root, 'alpha')).map((hit) => hit.path)).toEqual(['a.md']);

    writeWithMtime(join(root, 'a.md'), 'gamma three', 1_700_000_100);
    expect(await searchMindRoot(root, 'alpha')).toEqual([]);
    expect((await searchMindRoot(root, 'gamma')).map((hit) => hit.path)).toEqual(['a.md']);
    expect((await searchMindRoot(root, 'beta')).map((hit) => hit.path)).toEqual(['b.md']);

    unlinkSync(join(root, 'b.md'));
    expect(await searchMindRoot(root, 'beta')).toEqual([]);
  });

  it('skips the stat walk while the tree version is unchanged', async () => {
    expect((await searchMindRoot(root, 'alpha', {}, { treeVersion: 1 })).map((hit) => hit.path)).toEqual(['a.md']);

    // Same tree version: the index trusts the cache and does not notice the edit yet.
    writeWithMtime(join(root, 'a.md'), 'delta four', 1_700_000_200);
    expect((await searchMindRoot(root, 'alpha', {}, { treeVersion: 1 })).map((hit) => hit.path)).toEqual(['a.md']);

    // Bumped tree version: refreshed incrementally.
    expect(await searchMindRoot(root, 'alpha', {}, { treeVersion: 2 })).toEqual([]);
    expect((await searchMindRoot(root, 'delta', {}, { treeVersion: 2 })).map((hit) => hit.path)).toEqual(['a.md']);
  });

  it('prewarm builds the index once and reports a hit afterwards', async () => {
    expect(prewarmRuntimeSearch(root, { treeVersion: 5 })).toEqual({ cacheState: 'built', documentCount: 2 });
    expect(prewarmRuntimeSearch(root, { treeVersion: 5 })).toEqual({ cacheState: 'hit', documentCount: 2 });
    expect((await searchMindRoot(root, 'beta', {}, { treeVersion: 5 })).map((hit) => hit.path)).toEqual(['b.md']);
  });
});
