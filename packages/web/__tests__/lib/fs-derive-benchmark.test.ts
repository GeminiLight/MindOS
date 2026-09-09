/**
 * Cost of re-deriving the Web FileNode tree after a tree-version change.
 *
 * `lib/fs.ts` rebuilds its derived state (sorted path list, FileNode tree,
 * scaffold-filtered file list, recent files) from the core cache's in-memory
 * stats whenever the core tree version moves. This suite feeds it a synthetic
 * 20k-file list through a fake core cache so the number is CPU-only (no disk
 * walk) and reproducible; the measured medians are recorded in
 * `wiki/specs/spec-audit-leftovers-2026-09.md`. The assertion is a loose
 * regression gate (5x the ~20 ms budget) so a slow CI box does not flake.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { MindRootTreeCache, MindosRuntimeFileStat, TreeCacheFlushResult } from '@geminilight/mindos/server';
import { isDefaultMindSystemScaffoldFile } from '@/lib/mind-system-scaffold';
import { getTestMindRoot } from '../setup';

const DIRECTORIES = 200;
const FILES_PER_DIRECTORY = 100;
const SPACES = 40;
const BUDGET_MS = 20;

const fake = vi.hoisted(() => ({
  version: 1,
  stats: [] as Array<{ path: string; mtime: number; size: number }>,
  listeners: new Set<(version: number) => void>(),
}));

vi.mock('@/lib/core/mind-root-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core/mind-root-cache')>();
  const cache: MindRootTreeCache = {
    root: '/synthetic',
    getTreeVersion: () => fake.version,
    collectAllFiles: () => fake.stats.map((entry) => entry.path),
    collectFileStats: () => fake.stats.map((entry) => ({ ...entry })),
    getFileStat: (relativePath: string): MindosRuntimeFileStat | null => fake.stats.find((entry) => entry.path === relativePath) ?? null,
    getRecentlyModified: (limit = 10) => [...fake.stats].sort((a, b) => b.mtime - a.mtime).slice(0, limit),
    invalidate: () => { fake.version += 1; },
    refreshPath: () => { fake.version += 1; return 'changed'; },
    handleWatcherEvent: () => {},
    flushWatcherChanges: (): TreeCacheFlushResult => ({ kind: 'none', changed: [] }),
    subscribe: (listener) => { fake.listeners.add(listener); return () => { fake.listeners.delete(listener); }; },
    isWatching: () => false,
    startWatcher: () => {},
    stopWatcher: () => {},
    dispose: () => {},
  };
  return { ...actual, getWebTreeCache: () => cache };
});

function seedSyntheticStats(): void {
  const stats: Array<{ path: string; mtime: number; size: number }> = [];
  const base = 1_700_000_000_000;
  for (let dir = 0; dir < DIRECTORIES; dir += 1) {
    const dirName = `dir-${String(dir).padStart(3, '0')}`;
    if (dir < SPACES) {
      stats.push({ path: `${dirName}/INSTRUCTION.md`, mtime: base + dir, size: 120 });
      stats.push({ path: `${dirName}/README.md`, mtime: base + dir, size: 240 });
    }
    for (let file = 0; file < FILES_PER_DIRECTORY; file += 1) {
      const ext = file % 10 === 0 ? 'csv' : 'md';
      stats.push({
        path: `${dirName}/note-${String(file).padStart(4, '0')}.${ext}`,
        mtime: base + (dir * FILES_PER_DIRECTORY + file) * 1_000,
        size: 512 + file,
      });
    }
  }
  fake.stats = stats;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe('lib/fs derived tree re-derivation cost (20k synthetic files)', () => {
  it('re-derives the tree well inside the budget after a version change', async () => {
    seedSyntheticStats();
    const root = getTestMindRoot();
    const fsLib = await import('@/lib/fs');

    // First derivation includes the one-off mind-system upgrade check; warm it.
    const initial = fsLib.getFileTree();
    expect(fsLib.collectAllFiles().length).toBe(fake.stats.length);
    expect(initial.filter((node) => node.isSpace).length).toBe(SPACES);

    const samples: number[] = [];
    for (let round = 0; round < 10; round += 1) {
      fake.version += 1;
      const started = performance.now();
      const tree = fsLib.getFileTree();
      samples.push(performance.now() - started);
      expect(tree.length).toBe(DIRECTORIES);
    }
    const medianMs = median(samples);
    const recent = fsLib.getRecentlyModified(3);
    expect(recent[0]?.path).toBe('dir-199/note-0099.md');

    // Stage breakdown of the pure pieces the derivation runs, measured on the
    // same data so the spec can say where the remaining time goes.
    const paths = fake.stats.map((entry) => entry.path);
    const stage = (fn: () => unknown) => {
      const started = performance.now();
      fn();
      return performance.now() - started;
    };
    const sortMs = stage(() => paths.slice().sort((a, b) => a.localeCompare(b)));
    const joinMs = stage(() => paths.join('\n'));
    const scaffoldMs = stage(() => paths.filter((filePath) => !isDefaultMindSystemScaffoldFile(root, filePath)));
    const recentSortMs = stage(() => fake.stats.map((entry) => ({ path: entry.path, mtime: entry.mtime })).sort((a, b) => b.mtime - a.mtime));

    console.info(
      `[fs-derive-benchmark] files=${fake.stats.length} median=${medianMs.toFixed(2)}ms samples=${samples.map((s) => s.toFixed(1)).join(',')}`
      + ` | stages: sort=${sortMs.toFixed(1)}ms join=${joinMs.toFixed(1)}ms scaffoldFilter=${scaffoldMs.toFixed(1)}ms recentSort=${recentSortMs.toFixed(1)}ms`,
    );
    expect(medianMs).toBeLessThan(BUDGET_MS * 5);
  });
});
