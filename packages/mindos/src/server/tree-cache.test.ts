import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMindRootTreeCache, type MindRootTreeCache } from './tree-cache.js';

const cleanups: Array<() => void> = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mindos-tree-cache-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function track(cache: MindRootTreeCache): MindRootTreeCache {
  cleanups.push(() => cache.dispose());
  return cache;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('mind root tree cache', () => {
  it('returns version 0 and empty listings for a missing mind root', () => {
    const cache = track(createMindRootTreeCache(join(tmpdir(), 'mindos-tree-cache-does-not-exist'), { watch: false }));
    expect(cache.getTreeVersion()).toBe(0);
    expect(cache.collectAllFiles()).toEqual([]);
    expect(cache.getRecentlyModified(5)).toEqual([]);
  });

  it('matches the uncached file listing semantics (sorted, filtered, ignored dirs excluded)', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Space'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'Space', 'b.md'), 'b');
    writeFileSync(join(root, 'a.md'), 'a');
    writeFileSync(join(root, 'notes.txt'), 'not allowed extension');
    writeFileSync(join(root, '.git', 'internal.md'), 'ignored dir');
    writeFileSync(join(root, 'node_modules', 'pkg.md'), 'ignored dir');

    const cache = track(createMindRootTreeCache(root, { watch: false }));
    expect(cache.collectAllFiles()).toEqual(['a.md', 'Space/b.md']);
    expect(cache.getTreeVersion()).toBeGreaterThan(0);
  });

  it('serves the cached listing without rescanning until invalidated', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = track(createMindRootTreeCache(root, { watch: false, fallbackTtlMs: 60_000 }));

    const before = cache.getTreeVersion();
    expect(cache.collectAllFiles()).toEqual(['a.md']);

    writeFileSync(join(root, 'b.md'), 'b');
    // Still cached: no watcher, TTL not expired, no invalidate yet.
    expect(cache.collectAllFiles()).toEqual(['a.md']);
    expect(cache.getTreeVersion()).toBe(before);

    cache.invalidate();
    expect(cache.collectAllFiles()).toEqual(['a.md', 'b.md']);
    expect(cache.getTreeVersion()).toBeGreaterThan(before);
  });

  it('keeps the version stable across rebuilds when nothing changed', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = track(createMindRootTreeCache(root, { watch: false, fallbackTtlMs: 60_000 }));
    const before = cache.getTreeVersion();
    cache.invalidate();
    expect(cache.getTreeVersion()).toBe(before);
  });

  it('bumps the version when a file is deleted even though max mtime decreases', () => {
    const root = makeRoot();
    const newest = join(root, 'newest.md');
    const oldest = join(root, 'oldest.md');
    writeFileSync(newest, 'newest');
    writeFileSync(oldest, 'oldest');
    // Make `oldest.md` strictly older so deleting it cannot move max mtime.
    utimesSync(oldest, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

    const cache = track(createMindRootTreeCache(root, { watch: false }));
    const before = cache.getTreeVersion();

    rmSync(oldest);
    cache.invalidate();

    expect(cache.getTreeVersion()).toBeGreaterThan(before);
    expect(cache.collectAllFiles()).toEqual(['newest.md']);
  });

  it('falls back to TTL-based refresh when no watcher is available', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    let clock = 1_000;
    const cache = track(createMindRootTreeCache(root, { watch: false, fallbackTtlMs: 2_000, now: () => clock }));

    const before = cache.getTreeVersion();
    writeFileSync(join(root, 'b.md'), 'b');

    clock += 1_000; // within TTL — still cached
    expect(cache.collectAllFiles()).toEqual(['a.md']);

    clock += 2_000; // TTL expired — picks up the external write
    expect(cache.collectAllFiles()).toEqual(['a.md', 'b.md']);
    expect(cache.getTreeVersion()).toBeGreaterThan(before);
  });

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'picks up external file changes through the recursive watcher',
    async () => {
      const root = makeRoot();
      writeFileSync(join(root, 'a.md'), 'a');
      const cache = track(createMindRootTreeCache(root, { fallbackTtlMs: 3_600_000, watchedTtlMs: 3_600_000 }));
      const before = cache.getTreeVersion();
      expect(cache.isWatching()).toBe(true);

      writeFileSync(join(root, 'external.md'), 'written by another process');

      await vi.waitFor(() => {
        expect(cache.getTreeVersion()).toBeGreaterThan(before);
      }, { timeout: 4_000, interval: 50 });
      expect(cache.collectAllFiles()).toContain('external.md');
    },
    10_000,
  );

  it('keeps serving (via TTL) after dispose stops the watcher', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    let clock = 1_000;
    const cache = track(createMindRootTreeCache(root, { fallbackTtlMs: 2_000, watchedTtlMs: 2_000, now: () => clock }));
    const before = cache.getTreeVersion();

    cache.dispose();
    expect(cache.isWatching()).toBe(false);

    writeFileSync(join(root, 'b.md'), 'b');
    clock += 3_000;
    expect(cache.collectAllFiles()).toEqual(['a.md', 'b.md']);
    expect(cache.getTreeVersion()).toBeGreaterThan(before);
  });

  it('returns recently modified files sorted by mtime with bounded limits', () => {
    const root = makeRoot();
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      const file = join(root, `note-${i}.md`);
      writeFileSync(file, `note ${i}`);
      utimesSync(file, new Date(now - i * 10_000), new Date(now - i * 10_000));
    }
    const cache = track(createMindRootTreeCache(root, { watch: false }));

    const recent = cache.getRecentlyModified(3);
    expect(recent.map((entry) => entry.path)).toEqual(['note-0.md', 'note-1.md', 'note-2.md']);

    expect(cache.getRecentlyModified(0)).toHaveLength(1); // lower bound clamps to 1
    expect(cache.getRecentlyModified(100)).toHaveLength(5); // upper bound clamps to 30, fewer files than that
  });

  it('returns defensive copies so callers cannot corrupt the cache', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = track(createMindRootTreeCache(root, { watch: false, fallbackTtlMs: 60_000 }));

    cache.collectAllFiles().push('injected.md');
    expect(cache.collectAllFiles()).toEqual(['a.md']);

    const recent = cache.getRecentlyModified(5);
    recent.pop();
    expect(cache.getRecentlyModified(5)).toHaveLength(1);
  });

  it('survives invalidate and dispose being called before any read', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = createMindRootTreeCache(root, { watch: false });
    expect(() => cache.invalidate()).not.toThrow();
    expect(() => cache.dispose()).not.toThrow();
    expect(cache.collectAllFiles()).toEqual(['a.md']);
    expect(() => cache.dispose()).not.toThrow();
  });
});
