/**
 * P1 regression tests: the embedding index must not re-embed unchanged
 * content (content-hash dedup) and the incremental updateFile channel must
 * work for single-file changes.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { getEmbeddings, getEmbedding } from '@/lib/core/embedding-provider';
import { EmbeddingIndex } from '@/lib/core/embedding-index';

vi.mock('@/lib/core/embedding-provider', () => ({
  getEmbeddingConfig: vi.fn(() => ({ provider: 'local', model: 'test-model', baseUrl: '', apiKey: '' })),
  getEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0, 0]))),
  getEmbedding: vi.fn(async () => new Float32Array([0, 1, 0])),
}));

describe('EmbeddingIndex content-hash dedup', () => {
  let mindRoot: string;
  let persistDir: string;
  let index: EmbeddingIndex;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-embed-'));
    seedFile(mindRoot, 'a.md', 'first document about apples');
    seedFile(mindRoot, 'b.md', 'second document about bananas');
    index = new EmbeddingIndex({ persistDir });
    vi.mocked(getEmbeddings).mockClear();
    vi.mocked(getEmbedding).mockClear();
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
    fs.rmSync(persistDir, { recursive: true, force: true });
  });

  it('embeds every md/csv file on the first rebuild', async () => {
    await index.rebuild(mindRoot);
    expect(index.getDocCount()).toBe(2);
    expect(getEmbeddings).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getEmbeddings).mock.calls[0][0]).toHaveLength(2);
  });

  it('skips re-embedding unchanged files on a subsequent rebuild', async () => {
    await index.rebuild(mindRoot);
    vi.mocked(getEmbeddings).mockClear();
    await index.rebuild(mindRoot);
    expect(index.getDocCount()).toBe(2);
    expect(getEmbeddings).not.toHaveBeenCalled();
  });

  it('re-embeds only the changed file on rebuild', async () => {
    await index.rebuild(mindRoot);
    vi.mocked(getEmbeddings).mockClear();
    seedFile(mindRoot, 'a.md', 'first document rewritten about apricots');
    await index.rebuild(mindRoot);
    expect(getEmbeddings).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getEmbeddings).mock.calls[0][0]).toHaveLength(1);
    expect(index.getDocCount()).toBe(2);
  });

  it('drops vectors of deleted files on rebuild', async () => {
    await index.rebuild(mindRoot);
    fs.rmSync(path.join(mindRoot, 'b.md'));
    await index.rebuild(mindRoot);
    expect(index.getDocCount()).toBe(1);
  });

  it('embeds newly added files on rebuild without touching existing ones', async () => {
    await index.rebuild(mindRoot);
    vi.mocked(getEmbeddings).mockClear();
    seedFile(mindRoot, 'c.md', 'third document about cherries');
    await index.rebuild(mindRoot);
    expect(index.getDocCount()).toBe(3);
    expect(vi.mocked(getEmbeddings).mock.calls[0][0]).toHaveLength(1);
  });

  it('updateFile skips embedding when content is unchanged', async () => {
    await index.rebuild(mindRoot);
    await index.updateFile(mindRoot, 'a.md');
    expect(getEmbedding).not.toHaveBeenCalled();
  });

  it('updateFile re-embeds when content changed', async () => {
    await index.rebuild(mindRoot);
    seedFile(mindRoot, 'a.md', 'first document changed to avocados');
    await index.updateFile(mindRoot, 'a.md');
    expect(getEmbedding).toHaveBeenCalledTimes(1);
  });

  it('updateFile indexes a brand-new file', async () => {
    await index.rebuild(mindRoot);
    seedFile(mindRoot, 'new.md', 'fresh content about figs');
    await index.updateFile(mindRoot, 'new.md');
    expect(index.getDocCount()).toBe(3);
  });

  it('updateFile tolerates a missing file (no crash, no embedding call)', async () => {
    await index.rebuild(mindRoot);
    await index.updateFile(mindRoot, 'does-not-exist.md');
    expect(getEmbedding).not.toHaveBeenCalled();
  });

  it('removeFile clears the vector and the hash so re-add embeds again', async () => {
    await index.rebuild(mindRoot);
    index.removeFile('a.md');
    expect(index.getDocCount()).toBe(1);
    vi.mocked(getEmbeddings).mockClear();
    await index.rebuild(mindRoot);
    expect(index.getDocCount()).toBe(2);
    expect(vi.mocked(getEmbeddings).mock.calls[0][0]).toHaveLength(1);
  });

  it('persists hashes so a fresh instance skips unchanged files after load', async () => {
    await index.rebuild(mindRoot);
    const fresh = new EmbeddingIndex({ persistDir });
    expect(fresh.load(mindRoot)).toBe(true);
    vi.mocked(getEmbeddings).mockClear();
    await fresh.rebuild(mindRoot);
    expect(getEmbeddings).not.toHaveBeenCalled();
  });
});
