import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { seedFile } from '../setup';
import { GET } from '../../app/api/export/route';

describe('GET /api/export', () => {
  it('exports files whose names legitimately contain double dots', async () => {
    seedFile('notes..md', '# Dotted');

    const res = await GET(new NextRequest('http://localhost/api/export?path=notes..md&format=md'));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# Dotted');
  });

  it('still blocks actual traversal through the core safe resolver', async () => {
    const res = await GET(new NextRequest('http://localhost/api/export?path=../secret.md&format=md'));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Access denied') });
  });
});
