import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile, testMindRoot } from '../setup';
import { GET } from '../../app/api/git/route';
import { invalidateCache } from '../../lib/fs';
import { execSync } from 'child_process';
import path from 'path';

function root() { return testMindRoot; }

function initGitRepo() {
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root(),
    stdio: 'pipe',
  });
}

describe('GET /api/git', () => {
  it('op=is_repo returns false for non-git dir', async () => {
    invalidateCache();
    const req = new NextRequest('http://localhost/api/git?op=is_repo');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isRepo).toBe(false);
  });

  it('op=is_repo returns true for git repo', async () => {
    initGitRepo();
    invalidateCache();
    const req = new NextRequest('http://localhost/api/git?op=is_repo');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isRepo).toBe(true);
  });

  it('op=history returns commit log for a file', async () => {
    initGitRepo();
    seedFile('test.md', '# Test');
    execSync('git add test.md && git commit -m "init"', { cwd: root(), stdio: 'pipe' });
    invalidateCache();

    const req = new NextRequest('http://localhost/api/git?op=history&path=test.md&limit=5');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].message).toBe('init');
    expect(body.entries[0].hash).toBeDefined();
  });

  it('op=show returns file content at a commit', async () => {
    initGitRepo();
    seedFile('show.md', 'version1');
    execSync('git add show.md && git commit -m "v1"', { cwd: root(), stdio: 'pipe' });
    const hash = execSync('git rev-parse HEAD', { cwd: root(), encoding: 'utf-8' }).trim();
    seedFile('show.md', 'version2');
    execSync('git add show.md && git commit -m "v2"', { cwd: root(), stdio: 'pipe' });
    invalidateCache();

    const req = new NextRequest(`http://localhost/api/git?op=show&path=show.md&commit=${hash}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('version1');
  });

  it('op=history returns error when path is missing', async () => {
    const req = new NextRequest('http://localhost/api/git?op=history');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('op=show returns error when commit is missing', async () => {
    const req = new NextRequest('http://localhost/api/git?op=show&path=x.md');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
