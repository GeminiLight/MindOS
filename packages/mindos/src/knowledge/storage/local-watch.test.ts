import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalFileSystem } from './local.js';
import type { FileSystemEvent } from './types.js';

const WAIT = { timeout: 5_000, interval: 25 };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('LocalFileSystem.watch (fs.watch recursive)', () => {
  let root: string;
  let events: FileSystemEvent[];
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-local-watch-'));
    events = [];
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    rmSync(root, { recursive: true, force: true });
  });

  async function startWatching(options: Parameters<LocalFileSystem['watch']>[1] = {}) {
    const fs = new LocalFileSystem();
    const result = await fs.watch(root, { persistent: false, ...options }, (event) => events.push(event));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('watch failed');
    cleanups.push(result.value);
    // Give FSEvents / inotify a moment to arm before mutating the tree.
    await delay(150);
    return result.value;
  }

  const ofType = (type: FileSystemEvent['type']) => events.filter((event) => event.type === type);

  it('reports a created file as add with stats', async () => {
    await startWatching();
    const target = join(root, 'note.md');
    writeFileSync(target, 'hello');

    await vi.waitFor(() => expect(ofType('add').map((event) => event.path)).toContain(target), WAIT);
    const added = ofType('add').find((event) => event.path === target);
    expect(added?.stats).toMatchObject({ path: target, isFile: true, isDirectory: false });
    expect(added?.stats?.size).toBe(5);
  });

  it('reports a modified known file as change and a removed file as unlink', async () => {
    const target = join(root, 'note.md');
    writeFileSync(target, 'v1');
    await startWatching();

    writeFileSync(target, 'v2 longer');
    await vi.waitFor(() => expect(ofType('change').map((event) => event.path)).toContain(target), WAIT);
    expect(ofType('add').map((event) => event.path)).not.toContain(target);

    rmSync(target);
    await vi.waitFor(() => expect(ofType('unlink').map((event) => event.path)).toContain(target), WAIT);
  });

  it('reports a new directory as addDir and files created inside it as add', async () => {
    await startWatching();
    const dir = join(root, 'Space');
    mkdirSync(dir);
    await vi.waitFor(() => expect(ofType('addDir').map((event) => event.path)).toContain(dir), WAIT);

    const nested = join(dir, 'inner.md');
    writeFileSync(nested, 'nested');
    await vi.waitFor(() => expect(ofType('add').map((event) => event.path)).toContain(nested), WAIT);
  });

  it('honours string and RegExp ignore rules', async () => {
    await startWatching({ ignored: ['skip.md', /\.tmp$/] });
    writeFileSync(join(root, 'skip.md'), 'ignored by name');
    writeFileSync(join(root, 'draft.tmp'), 'ignored by regexp');
    const kept = join(root, 'kept.md');
    writeFileSync(kept, 'kept');

    await vi.waitFor(() => expect(ofType('add').map((event) => event.path)).toContain(kept), WAIT);
    await delay(200);
    const paths = events.map((event) => event.path);
    expect(paths).not.toContain(join(root, 'skip.md'));
    expect(paths).not.toContain(join(root, 'draft.tmp'));
  });

  it('ignores changes below the configured depth', async () => {
    mkdirSync(join(root, 'deep'));
    await startWatching({ depth: 0 });
    const shallow = join(root, 'top.md');
    writeFileSync(shallow, 'top');
    writeFileSync(join(root, 'deep', 'below.md'), 'below');

    await vi.waitFor(() => expect(ofType('add').map((event) => event.path)).toContain(shallow), WAIT);
    await delay(200);
    expect(events.map((event) => event.path)).not.toContain(join(root, 'deep', 'below.md'));
  });

  it('emits the initial listing when ignoreInitial is false', async () => {
    mkdirSync(join(root, 'Space'));
    writeFileSync(join(root, 'Space', 'a.md'), 'a');
    writeFileSync(join(root, 'b.md'), 'b');
    await startWatching({ ignoreInitial: false });

    expect(ofType('addDir').map((event) => event.path)).toEqual([join(root, 'Space')]);
    expect(ofType('add').map((event) => event.path).sort()).toEqual([join(root, 'Space', 'a.md'), join(root, 'b.md')].sort());
  });

  it('stops delivering events after cleanup', async () => {
    const stop = await startWatching();
    stop();
    writeFileSync(join(root, 'after-stop.md'), 'late');
    await delay(300);
    expect(events).toEqual([]);
  });

  it('returns FILE_WATCH_ERROR for a missing directory', async () => {
    const fs = new LocalFileSystem();
    const result = await fs.watch(join(root, 'missing'), {}, () => {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FILE_WATCH_ERROR');
  });
});
