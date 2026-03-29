import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-tree-version-test-'));
  vi.resetModules();
  vi.doMock('@/lib/settings', () => ({
    effectiveSopRoot: () => tempRoot,
  }));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('GET /api/tree-version', () => {
  it('bumps after an external file is added once the cache becomes stale', async () => {
    const fsLib = await import('@/lib/fs');
    const route = await import('@/app/api/tree-version/route');

    fsLib.getFileTree(); // warm empty cache
    const before = await route.GET();
    expect((await before.json()).v).toBe(0);

    fs.writeFileSync(path.join(tempRoot, 'external.md'), '# external', 'utf-8');
    await new Promise((r) => setTimeout(r, 5100));

    const after = await route.GET();
    expect((await after.json()).v).toBe(1);
  }, 12_000);

  it('does not bump when the file list is unchanged across a stale-cache refresh', async () => {
    const fsLib = await import('@/lib/fs');
    const route = await import('@/app/api/tree-version/route');

    fs.writeFileSync(path.join(tempRoot, 'existing.md'), '# one', 'utf-8');
    fsLib.invalidateCache();
    await route.GET(); // baseline after warming
    await new Promise((r) => setTimeout(r, 5100));

    const after = await route.GET();
    expect((await after.json()).v).toBe(1);
  }, 12_000);
});
