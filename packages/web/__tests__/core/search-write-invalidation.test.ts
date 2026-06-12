/**
 * P0 regression tests: the core BM25 search index must stay in sync with
 * writes that flow through the app fs layer (`lib/fs.ts`) and with external
 * modifications picked up by the tree-cache refresh / file watcher.
 *
 * Before the fix, the four index-invalidation hooks in `lib/fs.ts` were
 * no-ops, so any file created/modified/deleted after the index was first
 * built stayed invisible to search until a server restart.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { seedFile, getTestMindRoot } from '../setup';
import {
  createFile,
  saveFileContent,
  deleteFile,
  renameFile,
  moveFile,
  appendToFile,
  deleteDirectory,
  moveToTrashFile,
  invalidateCache,
  getMindRoot,
  getFileTree,
  handleWatcherEvent,
  flushWatcherChanges,
} from '@/lib/fs';
import { searchFiles } from '@/lib/core/search';

function resultPaths(root: string, query: string): string[] {
  return searchFiles(root, query).map((r) => r.path);
}

describe('search index invalidation through the fs layer', () => {
  let root: string;

  beforeEach(() => {
    root = getTestMindRoot();
    seedFile('notes/alpha.md', 'seeded alphabison fact');
    invalidateCache();
    // Build the index once (simulates server having served a search already).
    expect(resultPaths(root, 'alphabison')).toContain('notes/alpha.md');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds a file created through the fs layer without restart', () => {
    createFile('notes/zebra.md', 'zebrawombat appeared after index build');
    expect(resultPaths(root, 'zebrawombat')).toContain('notes/zebra.md');
  });

  it('reflects modified content after saveFileContent', () => {
    saveFileContent('notes/alpha.md', 'now about quokkamarsupial instead');
    expect(resultPaths(root, 'quokkamarsupial')).toContain('notes/alpha.md');
    // Old body token must no longer match.
    expect(resultPaths(root, 'alphabison')).not.toContain('notes/alpha.md');
  });

  it('reflects appended content after appendToFile', () => {
    appendToFile('notes/alpha.md', 'appended pangolinarmor detail');
    expect(resultPaths(root, 'pangolinarmor')).toContain('notes/alpha.md');
  });

  it('stops returning a file after deleteFile', () => {
    deleteFile('notes/alpha.md');
    expect(resultPaths(root, 'alphabison')).toEqual([]);
  });

  it('stops returning a file after moveToTrashFile', () => {
    moveToTrashFile('notes/alpha.md');
    expect(resultPaths(root, 'alphabison')).toEqual([]);
  });

  it('returns the new path after renameFile', () => {
    renameFile('notes/alpha.md', 'omega.md');
    const paths = resultPaths(root, 'alphabison');
    expect(paths).toContain('notes/omega.md');
    expect(paths).not.toContain('notes/alpha.md');
  });

  it('returns the new path after moveFile', () => {
    seedFile('archive/.keep.md', 'placeholder');
    invalidateCache();
    moveFile('notes/alpha.md', 'archive/alpha.md');
    const paths = resultPaths(root, 'alphabison');
    expect(paths).toContain('archive/alpha.md');
    expect(paths).not.toContain('notes/alpha.md');
  });

  it('stops returning files under a directory after deleteDirectory', () => {
    deleteDirectory('notes');
    expect(resultPaths(root, 'alphabison')).toEqual([]);
  });

  it('handles unicode file names and CJK content', () => {
    createFile('notes/笔记.md', '量子计算研究进展');
    expect(resultPaths(root, '量子')).toContain('notes/笔记.md');
  });

  it('survives an update notification for a file that cannot be read', () => {
    // Simulates a watcher race: file disappears between event and indexing.
    const ghost = path.join(root, 'notes', 'ghost.md');
    fs.writeFileSync(ghost, 'ghostlyion content', 'utf-8');
    handleWatcherEvent('notes/ghost.md');
    fs.rmSync(ghost);
    flushWatcherChanges();
    // No crash, and search still works for remaining files.
    expect(resultPaths(root, 'alphabison')).toContain('notes/alpha.md');
  });
});

describe('search index invalidation for external changes', () => {
  let root: string;

  beforeEach(() => {
    root = getTestMindRoot();
    seedFile('notes/alpha.md', 'seeded alphabison fact');
    invalidateCache();
    expect(resultPaths(root, 'alphabison')).toContain('notes/alpha.md');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('picks up an externally created file via watcher events', () => {
    fs.writeFileSync(path.join(root, 'external.md'), 'xylophonebadger from VSCode', 'utf-8');
    handleWatcherEvent('external.md');
    flushWatcherChanges();
    expect(resultPaths(root, 'xylophonebadger')).toContain('external.md');
  });

  it('picks up an externally modified file via watcher events', () => {
    fs.writeFileSync(path.join(root, 'notes', 'alpha.md'), 'rewritten narwhalhorn text', 'utf-8');
    handleWatcherEvent(path.join('notes', 'alpha.md'));
    flushWatcherChanges();
    expect(resultPaths(root, 'narwhalhorn')).toContain('notes/alpha.md');
    expect(resultPaths(root, 'alphabison')).not.toContain('notes/alpha.md');
  });

  it('drops an externally deleted file via watcher events', () => {
    fs.rmSync(path.join(root, 'notes', 'alpha.md'));
    handleWatcherEvent('notes/alpha.md');
    flushWatcherChanges();
    expect(resultPaths(root, 'alphabison')).toEqual([]);
  });

  it('ignores watcher events under ignored directories like .mindos', () => {
    handleWatcherEvent('.mindos/state.json');
    flushWatcherChanges();
    // Index untouched, no invalidation storm.
    expect(resultPaths(root, 'alphabison')).toContain('notes/alpha.md');
  });

  it('falls back to full invalidation when the event batch overflows', () => {
    fs.writeFileSync(path.join(root, 'bulk.md'), 'capybaraherd content', 'utf-8');
    handleWatcherEvent(null); // unknown path → must not be silently dropped
    flushWatcherChanges();
    expect(resultPaths(root, 'capybaraherd')).toContain('bulk.md');
  });

  it('picks up external changes via the tree-cache TTL refresh path', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    invalidateCache();
    getFileTree(); // build tree cache at t0
    expect(resultPaths(root, 'alphabison')).toContain('notes/alpha.md');

    const abs = path.join(root, 'ttl-pickup.md');
    fs.writeFileSync(abs, 'ferretburrow appeared externally', 'utf-8');
    fs.utimesSync(abs, new Date('2026-01-01T00:00:40.000Z'), new Date('2026-01-01T00:00:40.000Z'));

    vi.setSystemTime(new Date('2026-01-01T00:00:31.000Z'));
    getFileTree(); // TTL expired → refresh detects signature change → invalidates
    expect(resultPaths(root, 'ferretburrow')).toContain('ttl-pickup.md');
  });
});
