import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMindRootTreeCache,
  getMindRootTreeCache,
  resetMindRootTreeCachesForTests,
  type MindRootTreeCache,
} from './tree-cache.js';

const cleanups: Array<() => void> = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mindos-tree-cache-incremental-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function track(cache: MindRootTreeCache): MindRootTreeCache {
  cleanups.push(() => cache.dispose());
  return cache;
}

/** A cache whose TTL never expires so only explicit signals can change it. */
function frozenCache(root: string): MindRootTreeCache {
  return track(createMindRootTreeCache(root, { watch: false, fallbackTtlMs: 3_600_000 }));
}

afterEach(() => {
  vi.useRealTimers();
  resetMindRootTreeCachesForTests();
  while (cleanups.length) cleanups.pop()?.();
});

describe('tree cache refreshPath (single-file updates)', () => {
  it('adds, changes and removes one file without a full rescan', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = frozenCache(root);
    const v0 = cache.getTreeVersion();

    writeFileSync(join(root, 'Space', 'b.md').replace(`${root}/Space/b.md`, `${root}/b.md`), 'b');
    // Not visible yet: TTL is frozen and nothing signalled the cache.
    expect(cache.collectAllFiles()).toEqual(['a.md']);

    expect(cache.refreshPath('b.md')).toBe('added');
    expect(cache.collectAllFiles()).toEqual(['a.md', 'b.md']);
    const v1 = cache.getTreeVersion();
    expect(v1).toBeGreaterThan(v0);
    expect(cache.getFileStat('b.md')).toMatchObject({ path: 'b.md', size: 1 });

    writeFileSync(join(root, 'b.md'), 'longer content');
    expect(cache.refreshPath('b.md')).toBe('changed');
    expect(cache.getFileStat('b.md')?.size).toBe('longer content'.length);
    expect(cache.getTreeVersion()).toBeGreaterThan(v1);

    expect(cache.refreshPath('b.md')).toBe('unchanged');

    rmSync(join(root, 'b.md'));
    expect(cache.refreshPath('b.md')).toBe('removed');
    expect(cache.collectAllFiles()).toEqual(['a.md']);
    expect(cache.getFileStat('b.md')).toBeNull();
  });

  it('accepts Windows separators and ./ prefixes and ignores excluded paths', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'Space'));
    writeFileSync(join(root, 'Space', 'note.md'), 'n');
    const cache = frozenCache(root);
    cache.getTreeVersion();

    writeFileSync(join(root, 'Space', 'new.md'), 'new');
    expect(cache.refreshPath('.\\Space\\new.md'.replace(/^\.\\/, './'))).toBe('added');
    expect(cache.collectAllFiles()).toContain('Space/new.md');

    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.md'), 'dep');
    expect(cache.refreshPath('node_modules/pkg/index.md')).toBe('unchanged');
    expect(cache.collectAllFiles()).not.toContain('node_modules/pkg/index.md');

    writeFileSync(join(root, 'notes.txt'), 'not allowed');
    expect(cache.refreshPath('notes.txt')).toBe('unchanged');
  });

  it('falls back to a full rescan for directories and the ignore file', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = frozenCache(root);
    cache.getTreeVersion();

    mkdirSync(join(root, 'Moved'));
    writeFileSync(join(root, 'Moved', 'inner.md'), 'inner');
    expect(cache.refreshPath('Moved')).toBe('unknown');
    // Dirty → the next read rescans and sees the whole subtree.
    expect(cache.collectAllFiles()).toEqual(['a.md', 'Moved/inner.md']);

    writeFileSync(join(root, '.mindosignore'), 'Moved/\n');
    expect(cache.refreshPath('.mindosignore')).toBe('unknown');
    expect(cache.collectAllFiles()).toEqual(['a.md']);
  });

  it('marks the cache dirty when nothing was built yet', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = frozenCache(root);
    expect(cache.refreshPath('a.md')).toBe('unknown');
    expect(cache.collectAllFiles()).toEqual(['a.md']);
  });

  it('keeps versions monotonic and notifies push subscribers immediately', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = frozenCache(root);
    const listener = vi.fn();
    cache.subscribe(listener);
    const v0 = cache.getTreeVersion();

    writeFileSync(join(root, 'b.md'), 'b');
    cache.refreshPath('b.md');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toBeGreaterThan(v0);

    // A full rescan with nothing else changed keeps the patched version.
    cache.invalidate();
    expect(cache.getTreeVersion()).toBe(listener.mock.calls[0]![0]);
  });
});

describe('tree cache watcher batching', () => {
  it('applies a small batch incrementally after the debounce', () => {
    vi.useFakeTimers();
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = track(createMindRootTreeCache(root, { watch: false, fallbackTtlMs: 3_600_000, watchBatchDebounceMs: 500 }));
    cache.getTreeVersion();

    writeFileSync(join(root, 'external.md'), 'from vscode');
    cache.handleWatcherEvent('external.md');
    vi.advanceTimersByTime(499);
    expect(cache.collectAllFiles()).toEqual(['a.md']);
    vi.advanceTimersByTime(1);
    expect(cache.collectAllFiles()).toEqual(['a.md', 'external.md']);
  });

  it('flushWatcherChanges reports per-path changes and drops ignored / unknown events', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = frozenCache(root);
    cache.getTreeVersion();

    writeFileSync(join(root, 'a.md'), 'a changed');
    writeFileSync(join(root, 'fresh.md'), 'fresh');
    cache.handleWatcherEvent('a.md');
    cache.handleWatcherEvent('fresh.md');
    cache.handleWatcherEvent('.mindos/state.json');
    cache.handleWatcherEvent('ghost.md'); // never existed

    const flush = cache.flushWatcherChanges();
    expect(flush.kind).toBe('incremental');
    expect(flush.changed).toEqual(expect.arrayContaining([
      { path: 'a.md', change: 'changed' },
      { path: 'fresh.md', change: 'added' },
    ]));
    expect(flush.changed).toHaveLength(2);
    expect(cache.flushWatcherChanges()).toEqual({ kind: 'none', changed: [] });
  });

  it('falls back to a full rescan for null filenames, oversized batches and directory events', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = track(createMindRootTreeCache(root, { watch: false, fallbackTtlMs: 3_600_000, watchBatchLimit: 2 }));
    cache.getTreeVersion();

    writeFileSync(join(root, 'bulk.md'), 'bulk');
    cache.handleWatcherEvent(null);
    expect(cache.flushWatcherChanges()).toEqual({ kind: 'full', changed: [] });
    expect(cache.collectAllFiles()).toEqual(['a.md', 'bulk.md']);

    for (const name of ['x1.md', 'x2.md', 'x3.md']) {
      writeFileSync(join(root, name), name);
      cache.handleWatcherEvent(name);
    }
    expect(cache.flushWatcherChanges().kind).toBe('full');
    expect(cache.collectAllFiles()).toEqual(['a.md', 'bulk.md', 'x1.md', 'x2.md', 'x3.md']);

    mkdirSync(join(root, 'Dir'));
    writeFileSync(join(root, 'Dir', 'd.md'), 'd');
    cache.handleWatcherEvent('Dir');
    expect(cache.flushWatcherChanges().kind).toBe('full');
    expect(cache.collectAllFiles()).toContain('Dir/d.md');
  });

  it('stopWatcher drops pending events and startWatcher re-arms on supported platforms', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const cache = track(createMindRootTreeCache(root, { fallbackTtlMs: 3_600_000, watchedTtlMs: 3_600_000 }));
    cache.getTreeVersion();
    const wasWatching = cache.isWatching();

    writeFileSync(join(root, 'pending.md'), 'p');
    cache.handleWatcherEvent('pending.md');
    cache.stopWatcher();
    expect(cache.isWatching()).toBe(false);
    expect(cache.flushWatcherChanges()).toEqual({ kind: 'none', changed: [] });

    cache.startWatcher();
    cache.getTreeVersion();
    expect(cache.isWatching()).toBe(wasWatching);
  });
});

describe('getMindRootTreeCache registry', () => {
  it('returns one instance per resolved root', () => {
    const root = makeRoot();
    const a = getMindRootTreeCache(root, { watch: false });
    const b = getMindRootTreeCache(`${root}/`, { watch: false });
    expect(a).toBe(b);
    expect(a.root).toBe(root);
    expect(getMindRootTreeCache(makeRoot(), { watch: false })).not.toBe(a);
  });
});
