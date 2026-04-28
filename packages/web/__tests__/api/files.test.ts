import { describe, it, expect } from 'vitest';
import { seedFile } from '../setup';
import { GET } from '../../app/api/files/route';
import { invalidateCache } from '../../lib/fs';

describe('GET /api/files', () => {
  it('returns empty array when no files exist', async () => {
    invalidateCache();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns seeded .md and .csv files', async () => {
    seedFile('notes/hello.md', '# Hello');
    seedFile('data/items.csv', 'a,b,c');
    seedFile('ignore.txt', 'not included');
    invalidateCache();

    const res = await GET();
    expect(res.status).toBe(200);
    const files: string[] = await res.json();

    expect(files).toContain('notes/hello.md');
    expect(files).toContain('data/items.csv');
    expect(files).not.toContain('ignore.txt');
  });

  it('ignores .git and node_modules directories', async () => {
    seedFile('.git/config', 'git stuff');
    seedFile('node_modules/pkg/index.md', 'pkg');
    seedFile('real.md', 'real file');
    invalidateCache();

    const res = await GET();
    const files: string[] = await res.json();

    expect(files).toContain('real.md');
    expect(files.some(f => f.includes('.git'))).toBe(false);
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });
});
