import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { GET } from '../../app/api/bootstrap/route';
import { invalidateCache } from '../../lib/fs';

describe('GET /api/bootstrap', () => {
  it('returns root files when they exist', async () => {
    seedFile('INSTRUCTION.md', '# Instructions');
    seedFile('README.md', '# Index');
    seedFile('CONFIG.json', '{"key": "val"}');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/bootstrap');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instruction).toBe('# Instructions');
    expect(body.index).toBe('# Index');
    expect(body.config_json).toBe('{"key": "val"}');
  });

  it('returns undefined for missing root files', async () => {
    invalidateCache();
    const req = new NextRequest('http://localhost/api/bootstrap');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Missing files should not be present (JSON serializes undefined as absent)
    expect(body.instruction).toBeUndefined();
  });

  it('includes target_dir files when specified', async () => {
    seedFile('Workflows/README.md', '# Workflows');
    seedFile('Workflows/INSTRUCTION.md', '# WF Instructions');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/bootstrap?target_dir=Workflows');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.target_readme).toBe('# Workflows');
    expect(body.target_instruction).toBe('# WF Instructions');
  });

  it('includes file_index with directory structure and file counts', async () => {
    seedFile('Projects/roadmap.md', '# Roadmap');
    seedFile('Projects/pricing.md', '# Pricing');
    seedFile('Journal/2026-04.md', '# April');
    seedFile('notes.md', 'some notes');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/bootstrap');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file_index).toBeDefined();
    expect(body.file_index).toContain('Projects/ (2 files)');
    expect(body.file_index).toContain('Journal/ (1 file)');
    expect(body.file_index).toContain('notes.md');
  });

  it('returns empty KB message for file_index when no files exist', async () => {
    invalidateCache();
    const req = new NextRequest('http://localhost/api/bootstrap');
    const res = await GET(req);
    const body = await res.json();
    expect(body.file_index).toBe('(empty knowledge base)');
  });
});
