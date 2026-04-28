import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { searchFiles } from '@/lib/core/search';

describe('BM25 search scoring', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
  });

  it('ranks rare terms higher than common terms', () => {
    // "search" appears in all 3 files → low IDF
    // "CRDT" appears in only 1 file → high IDF
    seedFile(mindRoot, 'Notes/common.md', 'search is a common search feature for search');
    seedFile(mindRoot, 'Notes/also-common.md', 'we also implement search functionality');
    seedFile(mindRoot, 'Notes/rare.md', 'search and CRDT algorithms are interesting');

    const results = searchFiles(mindRoot, 'CRDT');
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('Notes/rare.md');
  });

  it('scores shorter documents higher when term frequency is equal', () => {
    // Both have "algorithm" once, but short.md is much shorter → higher density
    seedFile(mindRoot, 'Notes/short.md', 'The algorithm works well.');
    seedFile(mindRoot, 'Notes/long.md', 'The algorithm ' + 'uses many words to describe things. '.repeat(50));

    const results = searchFiles(mindRoot, 'algorithm');
    expect(results.length).toBe(2);
    expect(results[0].path).toBe('Notes/short.md');
  });

  it('handles multi-word queries by summing per-term BM25 scores', () => {
    // "search" is common (in all), "vector" is rare (in 1)
    seedFile(mindRoot, 'Notes/a.md', 'search for things');
    seedFile(mindRoot, 'Notes/b.md', 'search with vector embeddings');
    seedFile(mindRoot, 'Notes/c.md', 'search the knowledge base');

    const results = searchFiles(mindRoot, 'vector search');
    // b.md should rank first because it has the rare word "vector"
    expect(results[0].path).toBe('Notes/b.md');
  });

  it('diminishes returns for repeated terms (saturation)', () => {
    // File with "search" 20 times should NOT score 20x more than file with it 5 times
    seedFile(mindRoot, 'Notes/moderate.md', ('search feature. ').repeat(5));
    seedFile(mindRoot, 'Notes/spammy.md', ('search ').repeat(20));
    seedFile(mindRoot, 'Notes/filler.md', 'nothing relevant here about databases');

    const results = searchFiles(mindRoot, 'search');
    expect(results.length).toBe(2);
    // Both should appear but the spammy one shouldn't dominate excessively
    const scores = results.map(r => r.score);
    // Spammy has 4x the occurrences but BM25 saturation means score ratio < 4x
    if (results[0].path === 'Notes/spammy.md') {
      expect(scores[0] / scores[1]).toBeLessThan(4);
    }
  });

  it('returns zero-score results when IDF is near zero (term in all docs)', () => {
    // When a term appears in every document, IDF approaches 0
    // BM25 should still return results but with low scores
    seedFile(mindRoot, 'Notes/a.md', 'common word here');
    seedFile(mindRoot, 'Notes/b.md', 'common word there');

    const results = searchFiles(mindRoot, 'common');
    expect(results.length).toBe(2);
    // Scores should be very low but not negative
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });
});
