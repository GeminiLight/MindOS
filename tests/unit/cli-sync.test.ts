import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempDir: string;
let mindosDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-sync-test-'));
  mindosDir = path.join(tempDir, '.mindos');
  configPath = path.join(mindosDir, 'config.json');

  vi.resetModules();
  vi.doUnmock('node:child_process');
  vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
    CONFIG_PATH: configPath,
    MINDOS_DIR: mindosDir,
  }));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function importSync() {
  return await import('../../packages/mindos/bin/lib/sync.js') as {
    initSync: (mindRoot: string, opts?: { nonInteractive?: boolean; remote?: string; token?: string; branch?: string }) => Promise<void>;
    setSyncEnabled: (enabled: boolean) => void;
    getSyncStatus: (mindRoot?: string) => {
      enabled: boolean;
      configured?: boolean;
      provider?: string;
      remote?: string;
      branch?: string;
    };
    manualSync: (mindRoot: string) => void;
    getSyncConflictBackupPath: (mindRoot: string, file: string) => string;
    getSyncGitignorePath: (mindRoot: string) => string;
    getSyncLockPath: (mindRoot: string) => string;
    acquireSyncLock: (mindRoot: string, operation: string, options?: { waitMs?: number }) => { lockPath: string; token: string | null };
    releaseSyncLock: (lock: { lockPath: string; token: string | null; reentrant?: boolean }) => void;
    withSyncLock: <T>(mindRoot: string, operation: string, callback: () => T, options?: { waitMs?: number }) => T;
  };
}

describe('mindos sync config persistence', () => {
  it('creates the config directory before writing sync settings', async () => {
    const { setSyncEnabled } = await importSync();

    expect(() => setSyncEnabled(true)).not.toThrow();
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).sync.enabled).toBe(true);
  });

  it('reads sync settings from a BOM-prefixed config file', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, `\uFEFF${JSON.stringify({ sync: { enabled: true, provider: 'git' } })}`, 'utf-8');

    const { getSyncStatus } = await importSync();

    expect(getSyncStatus(undefined)).toMatchObject({ enabled: true, provider: 'git' });
  });

  it('rejects conflict backup paths outside the knowledge base', async () => {
    const { getSyncConflictBackupPath } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    expect(() => getSyncConflictBackupPath(mindRoot, '../secret.md')).toThrow('Access denied');
    expect(getSyncConflictBackupPath(mindRoot, 'notes/a.md')).toBe(path.join(mindRoot, 'notes', 'a.md.sync-conflict'));
  });

  it('rejects .gitignore writes through symlinks outside the knowledge base', async () => {
    const { getSyncGitignorePath } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(mindRoot);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, '.gitignore'), 'outside\n', 'utf-8');
    fs.symlinkSync(path.join(outside, '.gitignore'), path.join(mindRoot, '.gitignore'));

    expect(() => getSyncGitignorePath(mindRoot)).toThrow('Access denied');
    expect(fs.readFileSync(path.join(outside, '.gitignore'), 'utf-8')).toBe('outside\n');
  });

  it('surfaces commit failures during manual sync', async () => {
    const commitError = Object.assign(new Error('Command failed: git commit'), {
      stderr: Buffer.from('fatal: unable to auto-detect email address\n'),
      stdout: Buffer.from(''),
    });
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') return 'git@example.com:mind/repo.git\n';
      if (args[0] === 'status' && args[1] === '--porcelain') return ' M note.md\n';
      if (args[0] === 'commit') throw commitError;
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { manualSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    expect(() => manualSync(mindRoot)).toThrow('Commit failed: fatal: unable to auto-detect email address');
    const state = JSON.parse(fs.readFileSync(path.join(mindosDir, 'sync-state.json'), 'utf-8'));
    expect(state.lastError).toBe('Commit failed: fatal: unable to auto-detect email address');
  });

  it('sets a repo-local Git identity before auto committing when none exists', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'remote' && args[1] === 'get-url') return 'git@example.com:mind/repo.git\n';
      if (args[0] === 'config' && args[1] === '--get') {
        const error = new Error(`missing ${args[2]}`);
        throw error;
      }
      if (args[0] === 'status' && args[1] === '--porcelain') return ' M note.md\n';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { manualSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    expect(() => manualSync(mindRoot)).not.toThrow();

    expect(calls).toContainEqual(['config', 'user.email', 'mindos@local']);
    expect(calls).toContainEqual(['config', 'user.name', 'MindOS']);
    expect(calls.some(args => args[0] === 'commit' && args[1] === '-m')).toBe(true);
  });

  it('uses the requested branch during non-interactive init', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'ls-remote') return '';
      if (args[0] === 'status' && args[1] === '--porcelain') return '';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    await initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://example.com/mind.git',
      branch: 'dev',
    });

    expect(calls).toContainEqual(['checkout', '-B', 'dev']);
    expect(calls).not.toContainEqual(['checkout', '-b', 'main']);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.sync.branch).toBe('dev');
  });

  it('pushes local changes after pulling an existing remote during non-interactive init', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'ls-remote') return 'abc123\trefs/heads/main\n';
      if (args[0] === 'config' && args[1] === '--get') return 'configured\n';
      if (args[0] === 'status' && args[1] === '--porcelain') return '?? local.md\n';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    await initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://example.com/mind.git',
      branch: 'main',
    });

    expect(calls).toContainEqual(['pull', 'origin', 'main', '--allow-unrelated-histories']);
    expect(calls.some(args => args[0] === 'commit' && args[1] === '-m')).toBe(true);
    expect(calls).toContainEqual(['push', '-u', 'origin', 'HEAD']);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.sync.enabled).toBe(true);
  });

  it('does not write HTTPS access tokens into the configured remote URL', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[], options?: { input?: string }) => {
      calls.push(args);
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'credential' && args[1] === 'fill') return options?.input?.includes('username=oauth2')
        ? 'protocol=https\nhost=example.com\nusername=oauth2\npassword=ghp_secret\n'
        : '';
      if (args[0] === 'ls-remote') return '';
      if (args[0] === 'config' && args[1] === '--get') return 'configured\n';
      if (args[0] === 'status' && args[1] === '--porcelain') return '';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    await initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://oauth2:ghp_secret@example.com/mind.git',
      branch: 'main',
    });

    const remoteCalls = calls.filter(args => args[0] === 'remote');
    expect(JSON.stringify(remoteCalls)).not.toContain('ghp_secret');
    expect(remoteCalls).toContainEqual(['remote', 'add', 'origin', 'https://example.com/mind.git']);
  });

  it('strips ordinary HTTPS usernames without treating them as access tokens', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'ls-remote') return '';
      if (args[0] === 'status' && args[1] === '--porcelain') return '';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    await initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://alice@example.com/mind.git',
      branch: 'main',
    });

    expect(calls.some(args => args[0] === 'credential')).toBe(false);
    expect(calls).toContainEqual(['remote', 'add', 'origin', 'https://example.com/mind.git']);
  });

  it('fails HTTPS token setup instead of falling back to an inline token remote', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'credential' && args[1] === 'approve') throw new Error('credential helper unavailable');
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://example.com/mind.git',
      token: 'ghp_secret',
      branch: 'main',
    })).rejects.toThrow('Git credential helper did not store the access token');

    expect(JSON.stringify(calls)).not.toContain('ghp_secret@example.com');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('rejects invalid branch names before configuring sync', async () => {
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://example.com/mind.git',
      branch: 'bad branch',
    })).rejects.toThrow('Invalid branch name: bad branch');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('redacts credentials from sync status remote URLs', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ sync: { enabled: true, provider: 'git' } }), 'utf-8');
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') return 'https://oauth2:ghp_secret@example.com/me/mind.git\n';
      if (args[0] === 'rev-parse') return 'main\n';
      if (args[0] === 'rev-list') return '0\n';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { getSyncStatus } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    const status = getSyncStatus(mindRoot);

    expect(status.remote).toBe('https://example.com/me/mind.git');
    expect(status.remote).not.toContain('ghp_secret');
  });

  it('keeps configured repository metadata when auto-sync is paused', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ sync: { enabled: false, provider: 'git' } }), 'utf-8');
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') return 'git@example.com:mind/repo.git\n';
      if (args[0] === 'rev-parse') return 'main\n';
      if (args[0] === 'rev-list') return '2\n';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { getSyncStatus } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    const status = getSyncStatus(mindRoot);

    expect(status).toMatchObject({
      enabled: false,
      configured: true,
      provider: 'git',
      remote: 'git@example.com:mind/repo.git',
      branch: 'main',
    });
  });

  it('does not keep the legacy allow-empty conflict commit fallback', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'packages/mindos/bin/lib/sync.js'), 'utf-8');

    expect(source).not.toContain('--allow-empty');
  });

  it('rejects manual sync when another process owns the sync lock', async () => {
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { manualSync, getSyncLockPath } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    const lockPath = getSyncLockPath(mindRoot);
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
      pid: process.pid,
      operation: 'pull',
      startedAt: new Date().toISOString(),
      token: 'other-owner',
    }), 'utf-8');

    expect(() => manualSync(mindRoot)).toThrow('SYNC_LOCKED: Sync is already running');
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('releases the sync lock when a locked operation throws', async () => {
    const { getSyncLockPath, withSyncLock } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot, { recursive: true });
    const lockPath = getSyncLockPath(mindRoot);

    expect(() => withSyncLock(mindRoot, 'test-throw', () => {
      throw new Error('boom');
    })).toThrow('boom');

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('does not let an old owner release a replacement sync lock', async () => {
    const { acquireSyncLock, releaseSyncLock, getSyncLockPath } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot, { recursive: true });
    const lock = acquireSyncLock(mindRoot, 'old-owner', { waitMs: 0 });
    const lockPath = getSyncLockPath(mindRoot);
    const replacementOwner = {
      pid: process.pid,
      operation: 'new-owner',
      startedAt: new Date().toISOString(),
      token: 'replacement-token',
    };
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(replacementOwner), 'utf-8');

    releaseSyncLock(lock);

    expect(fs.existsSync(lockPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf-8'))).toMatchObject(replacementOwner);
  });

  it('cleans up a stale dead-pid sync lock before manual sync', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'remote' && args[1] === 'get-url') return 'git@example.com:mind/repo.git\n';
      if (args[0] === 'status' && args[1] === '--porcelain') return '';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { manualSync, getSyncLockPath } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    const lockPath = getSyncLockPath(mindRoot);
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
      pid: 99999999,
      operation: 'dead-owner',
      startedAt: new Date().toISOString(),
      token: 'dead-token',
    }), 'utf-8');

    expect(() => manualSync(mindRoot)).not.toThrow();

    expect(calls).toContainEqual(['pull', '--rebase', '--autostash']);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('keeps manual sync under one manual-sync lock for pull and commit', async () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'packages/mindos/bin/lib/sync.js'), 'utf-8');
    const manualSyncSource = source.slice(source.indexOf('export function manualSync'), source.indexOf('/**\n * List conflict files'));

    expect(manualSyncSource).toContain("withSyncLock(mindRoot, 'manual-sync'");
    expect(manualSyncSource).toContain('autoPullUnlocked(mindRoot, isSshUrl)');
    expect(manualSyncSource).toContain('autoCommitAndPushUnlocked(mindRoot, isSshUrl)');
    expect(manualSyncSource).not.toContain('autoPull(mindRoot');
    expect(manualSyncSource).not.toContain('autoCommitAndPush(mindRoot');
  });
});
