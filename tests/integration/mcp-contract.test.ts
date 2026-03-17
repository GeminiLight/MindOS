import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const BASE_URL = process.env.MINDOS_URL ?? 'http://localhost:3456';

// Helper: call an App API endpoint
async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, init);
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('MCP ↔ App API contract', () => {
  let tempRoot: string;

  beforeAll(() => {
    // NOTE: These tests assume the app server is running and using a test MIND_ROOT.
    // In CI, set MIND_ROOT env var to a temp directory before starting the app.
    tempRoot = mkdtempSync(join(tmpdir(), 'mindos-integration-'));
    writeFileSync(join(tempRoot, 'README.md'), '# Test KB');
    mkdirSync(join(tempRoot, 'Notes'), { recursive: true });
    writeFileSync(join(tempRoot, 'Notes', 'hello.md'), '# Hello\nWorld');
  });

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('GET /api/files returns array', async () => {
    const { status, json } = await api('/api/files');
    expect(status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
  });

  it('GET /api/search?q=... returns results', async () => {
    const { status, json } = await api('/api/search?q=test');
    expect(status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
  });

  it('GET /api/bootstrap returns startup context', async () => {
    const { status, json } = await api('/api/bootstrap');
    expect(status).toBe(200);
    expect(typeof json).toBe('object');
    // instruction and index may be undefined if files don't exist in MIND_ROOT
    expect(['string', 'undefined']).toContain(typeof json.instruction);
    expect(['string', 'undefined']).toContain(typeof json.index);
  });

  it('GET /api/git?op=is_repo returns boolean', async () => {
    const { status, json } = await api('/api/git?op=is_repo');
    expect(status).toBe(200);
    expect(json).toHaveProperty('isRepo');
    expect(typeof json.isRepo).toBe('boolean');
  });
});
