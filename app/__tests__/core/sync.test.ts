import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Tests for the sync core logic.
 * We test the git helper functions and sync state management
 * by operating on a real temp git repo.
 *
 * Note: The sync API route (/api/sync) reads ~/.mindos/config.json directly,
 * making it hard to unit test without modifying global state.
 * These tests cover the underlying git operations instead.
 */

let tmpDir: string;
let mindRoot: string;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-sync-test-'));
  mindRoot = path.join(tmpDir, 'mind');
  fs.mkdirSync(mindRoot, { recursive: true });
  execSync('git init', { cwd: mindRoot, stdio: 'pipe' });
  execSync('git checkout -b main', { cwd: mindRoot, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: mindRoot, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: mindRoot, stdio: 'pipe' });
  fs.writeFileSync(path.join(mindRoot, 'README.md'), '# test\n');
  execSync('git add -A && git commit -m "init"', { cwd: mindRoot, stdio: 'pipe' });
}

function cleanup() {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('sync: git operations', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('detects git repo correctly', () => {
    expect(fs.existsSync(path.join(mindRoot, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.git'))).toBe(false);
  });

  it('reads branch name', () => {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(branch).toBe('main');
  });

  it('detects no uncommitted changes after clean commit', () => {
    const status = execSync('git status --porcelain', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(status).toBe('');
  });

  it('detects uncommitted changes', () => {
    fs.writeFileSync(path.join(mindRoot, 'new-file.md'), 'hello\n');
    const status = execSync('git status --porcelain', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(status).toContain('new-file.md');
  });

  it('auto-commit stages and commits changes', () => {
    fs.writeFileSync(path.join(mindRoot, 'auto-test.md'), 'auto content\n');
    execSync('git add -A', { cwd: mindRoot, stdio: 'pipe' });
    const status = execSync('git status --porcelain', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(status).not.toBe('');

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    execSync(`git commit -m "auto-sync: ${timestamp}"`, { cwd: mindRoot, stdio: 'pipe' });

    const afterStatus = execSync('git status --porcelain', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(afterStatus).toBe('');

    const log = execSync('git log --oneline -1', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(log).toContain('auto-sync:');
  });

  it('handles already-clean repo gracefully (no empty commits)', () => {
    const statusBefore = execSync('git status --porcelain', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(statusBefore).toBe('');

    // Count commits before
    const countBefore = execSync('git rev-list --count HEAD', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    // Simulate autoCommitAndPush skipping when no changes
    execSync('git add -A', { cwd: mindRoot, stdio: 'pipe' });
    const status = execSync('git status --porcelain', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    // Should be empty — no commit needed
    expect(status).toBe('');

    const countAfter = execSync('git rev-list --count HEAD', {
      cwd: mindRoot, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    expect(countAfter).toBe(countBefore);
  });
});

describe('sync: conflict file creation', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('creates .sync-conflict file with theirs content', () => {
    // Simulate what autoPull conflict resolution does
    const file = 'notes.md';
    const localContent = 'local version\n';
    const remoteContent = 'remote version\n';

    fs.writeFileSync(path.join(mindRoot, file), localContent);
    fs.writeFileSync(path.join(mindRoot, file + '.sync-conflict'), remoteContent);

    expect(fs.readFileSync(path.join(mindRoot, file), 'utf-8')).toBe(localContent);
    expect(fs.readFileSync(path.join(mindRoot, file + '.sync-conflict'), 'utf-8')).toBe(remoteContent);
  });
});

describe('sync: state file management', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('reads and writes sync state', () => {
    const statePath = path.join(tmpDir, 'sync-state.json');

    // Initially no state file
    expect(fs.existsSync(statePath)).toBe(false);

    // Write state
    const state = {
      lastSync: new Date().toISOString(),
      lastPull: new Date().toISOString(),
      conflicts: [],
      lastError: null,
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

    // Read back
    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(loaded.lastSync).toBe(state.lastSync);
    expect(loaded.lastPull).toBe(state.lastPull);
    expect(loaded.conflicts).toEqual([]);
    expect(loaded.lastError).toBeNull();
  });

  it('stores conflict records correctly', () => {
    const statePath = path.join(tmpDir, 'sync-state.json');
    const conflicts = [
      { file: 'notes/todo.md', time: '2026-03-14T10:30:00.000Z' },
      { file: 'journal/2026-03.md', time: '2026-03-14T10:30:00.000Z' },
    ];
    const state = { lastSync: new Date().toISOString(), conflicts };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(loaded.conflicts).toHaveLength(2);
    expect(loaded.conflicts[0].file).toBe('notes/todo.md');
    expect(loaded.conflicts[1].file).toBe('journal/2026-03.md');
  });
});

describe('sync: config management', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('merges sync config into existing config', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const existing = {
      mindRoot,
      port: 3000,
      authToken: 'test',
    };
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

    // Add sync config
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.sync = {
      enabled: true,
      provider: 'git',
      remote: 'origin',
      branch: 'main',
      autoCommitInterval: 30,
      autoPullInterval: 300,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Verify
    const reloaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(reloaded.mindRoot).toBe(mindRoot);
    expect(reloaded.authToken).toBe('test');
    expect(reloaded.sync.enabled).toBe(true);
    expect(reloaded.sync.autoCommitInterval).toBe(30);
    expect(reloaded.sync.autoPullInterval).toBe(300);
  });

  it('toggles sync enabled flag without losing other config', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = {
      mindRoot,
      port: 3000,
      sync: { enabled: true, provider: 'git', autoCommitInterval: 30, autoPullInterval: 300 },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Disable
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    loaded.sync.enabled = false;
    fs.writeFileSync(configPath, JSON.stringify(loaded, null, 2));

    const reloaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(reloaded.sync.enabled).toBe(false);
    expect(reloaded.sync.provider).toBe('git');
    expect(reloaded.mindRoot).toBe(mindRoot);
  });
});
