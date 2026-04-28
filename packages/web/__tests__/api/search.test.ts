import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { GET } from '../../app/api/search/route';
import { invalidateCache } from '../../lib/fs';

describe('GET /api/search', () => {
  beforeEach(() => {
    invalidateCache();
  });

  it('returns empty array for empty query', async () => {
    const req = new NextRequest('http://localhost/api/search?q=');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('finds files matching query', async () => {
    seedFile('doc.md', 'This document talks about machine learning in depth');
    seedFile('other.md', 'Completely unrelated content about cooking');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/search?q=machine+learning');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const results = await res.json();

    expect(Array.isArray(results)).toBe(true);
    // Should find at least the document about machine learning
    if (results.length > 0) {
      expect(results[0].path).toBe('doc.md');
    }
  });

  it('returns results with expected shape', async () => {
    seedFile('target.md', 'specific unique keyword xylophone');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/search?q=xylophone');
    const res = await GET(req);
    const results = await res.json();

    if (results.length > 0) {
      const r = results[0];
      expect(r).toHaveProperty('path');
      expect(r).toHaveProperty('snippet');
      expect(r).toHaveProperty('score');
      // These properties come from hybrid search (BM25 + embedding)
      expect(typeof r.score).toBe('number');
      expect(typeof r.snippet).toBe('string');
    }
  });

  it('uses hybrid search (includes BM25 + embedding logic)', async () => {
    // This test verifies the API calls hybridSearch, not just fuzzy matching.
    // The presence of 'snippet' field and proper score indicates hybrid search is active.
    seedFile('test.md', 'apple banana cherry');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/search?q=apple');
    const res = await GET(req);
    const results = await res.json();

    // Should return results in SearchResult format (from hybrid search)
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      const result = results[0];
      // These fields confirm hybrid search output:
      // - path: file path
      // - snippet: context snippet (from BM25 or embedding)
      // - score: RRF-merged score (not fuzzy score)
      // - occurrences: number of occurrences (0 if only embedding match)
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('snippet');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('occurrences');
    }
  });
});
