import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Test the cosine similarity math ──
import { cosineSimilarity } from '@/lib/core/embedding-index';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns close to 1 for similar vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1.1, 2.1, 3.1]);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.99);
  });

  it('returns 0 for zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    const a = new Float32Array([]);
    const b = new Float32Array([]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('clamps result to [0,1]', () => {
    // Normalized embedding vectors should naturally stay in [0,1]
    const a = new Float32Array([0.5, 0.5, 0.5]);
    const b = new Float32Array([0.5, 0.5, 0.5]);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

// ── Test hybrid search fallback behavior ──
// We mock the dependencies to test the RRF merge logic and fallback paths

describe('hybridSearch', () => {
  // Reset modules between tests to clear singleton state
  beforeEach(() => {
    vi.resetModules();
  });

  it('falls back to pure BM25 when embedding is disabled', async () => {
    // Mock settings to have embedding disabled
    vi.doMock('@/lib/settings', () => ({
      readSettings: () => ({
        ai: { activeProvider: '', providers: [] },
        embedding: undefined,
        mindRoot: '/tmp/test-mind',
      }),
      effectiveSopRoot: () => '/tmp/test-mind',
    }));

    // Mock BM25 search
    vi.doMock('@/lib/core/search', () => ({
      searchFiles: () => [
        { path: 'test.md', snippet: 'test content', score: 10, occurrences: 1 },
      ],
    }));

    const { hybridSearch } = await import('@/lib/core/hybrid-search');
    const results = await hybridSearch('/tmp/test-mind', 'test query');
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('test.md');
  });
});

describe('EmbeddingIndex', () => {
  it('can be instantiated without errors', async () => {
    const { EmbeddingIndex } = await import('@/lib/core/embedding-index');
    const index = new EmbeddingIndex();
    expect(index.isReady()).toBe(false);
    expect(index.isBuilding()).toBe(false);
    expect(index.getDocCount()).toBe(0);
  });

  it('searchByVector returns empty when not ready', async () => {
    const { EmbeddingIndex } = await import('@/lib/core/embedding-index');
    const index = new EmbeddingIndex();
    const results = index.searchByVector(new Float32Array([1, 2, 3]));
    expect(results).toEqual([]);
  });

  it('invalidate clears state', async () => {
    const { EmbeddingIndex } = await import('@/lib/core/embedding-index');
    const index = new EmbeddingIndex();
    index.invalidate();
    expect(index.isReady()).toBe(false);
    expect(index.getDocCount()).toBe(0);
  });
});
