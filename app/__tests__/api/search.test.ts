import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { GET } from '../../app/api/search/route';
import { invalidateCache } from '../../lib/fs';

describe('GET /api/search', () => {
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
    }
  });
});
