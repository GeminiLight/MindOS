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
    seedFile('CONFIG.md', '# Config');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/bootstrap');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instruction).toBe('# Instructions');
    expect(body.index).toBe('# Index');
    expect(body.config_json).toBe('{"key": "val"}');
    expect(body.config_md).toBe('# Config');
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
});
