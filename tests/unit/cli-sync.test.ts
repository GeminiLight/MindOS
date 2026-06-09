import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
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
  vi.useRealTimers();
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
    startSyncDaemon: (mindRoot: string) => Promise<unknown>;
    stopSyncDaemon: () => void;
  };
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'MindOS Test',
      GIT_AUTHOR_EMAIL: 'mindos-test@example.com',
      GIT_COMMITTER_NAME: 'MindOS Test',
      GIT_COMMITTER_EMAIL: 'mindos-test@example.com',
    },
  }).trim();
}

function commitAll(cwd: string, message: string): void {
  runGit(['add', '-A'], cwd);
  runGit(['commit', '-m', message], cwd);
}

function createBareRemoteWithFiles(files: Record<string, string>): string {
  const remotePath = path.join(tempDir, `remote-${Math.random().toString(16).slice(2)}.git`);
  const seedPath = path.join(tempDir, `seed-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(seedPath, { recursive: true });
  runGit(['init', '--bare', remotePath], tempDir);
  runGit(['init'], seedPath);
  runGit(['checkout', '-B', 'main'], seedPath);
  for (const [file, content] of Object.entries(files)) {
    const fullPath = path.join(seedPath, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
  commitAll(seedPath, 'seed remote');
  runGit(['remote', 'add', 'origin', remotePath], seedPath);
  runGit(['push', '-u', 'origin', 'main'], seedPath);
  return remotePath;
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

  it('keeps disabled broken sync configuration visible instead of reporting unconfigured', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot,
      sync: { enabled: false, provider: 'git' },
    }), 'utf-8');
    fs.writeFileSync(path.join(mindosDir, 'sync-state.json'), JSON.stringify({
      conflicts: ['note.md'],
      lastError: 'previous failure',
    }), 'utf-8');

    const { getSyncStatus } = await importSync();

    expect(getSyncStatus(mindRoot)).toMatchObject({
      enabled: false,
      configured: true,
      needsSetup: true,
      remote: '(not configured)',
      conflicts: [{ file: 'note.md' }],
      lastError: 'previous failure',
    });
  });

  it('reports enabled sync with a missing origin as a broken configured state', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot,
      sync: { enabled: true, provider: 'git' },
    }), 'utf-8');
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') throw new Error('No such remote');
      if (args[0] === 'rev-parse') return 'main\n';
      if (args[0] === 'rev-list') throw new Error('no upstream');
      if (args[0] === 'status') return '';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });

    const { getSyncStatus } = await importSync();

    expect(getSyncStatus(mindRoot)).toMatchObject({
      enabled: true,
      needsSetup: true,
      remote: '(not configured)',
      branch: 'main',
      lastError: 'Remote not configured. Please re-configure sync.',
    });
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

    expect(calls).toContainEqual(['pull', '--no-rebase', 'origin', 'main', '--allow-unrelated-histories']);
    expect(calls.some(args => args[0] === 'commit' && args[1] === '-m')).toBe(true);
    expect(calls).toContainEqual(['push', '-u', 'origin', 'HEAD']);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.sync.enabled).toBe(true);
  });

  it('initializes sync when local and remote already have unrelated non-conflicting commits', async () => {
    const remotePath = createBareRemoteWithFiles({ 'remote.md': 'remote\n' });
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);
    runGit(['init'], mindRoot);
    runGit(['checkout', '-B', 'main'], mindRoot);
    fs.writeFileSync(path.join(mindRoot, 'local.md'), 'local\n', 'utf-8');
    commitAll(mindRoot, 'local content');

    const { initSync } = await importSync();
    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: remotePath,
      branch: 'main',
    })).resolves.toBeUndefined();

    expect(fs.readFileSync(path.join(mindRoot, 'local.md'), 'utf-8')).toBe('local\n');
    expect(fs.readFileSync(path.join(mindRoot, 'remote.md'), 'utf-8')).toBe('remote\n');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).sync).toMatchObject({
      enabled: true,
      branch: 'main',
      remote: 'origin',
    });
    expect(runGit(['rev-list', '--count', 'origin/main..HEAD'], mindRoot)).toBe('0');
  });

  it('keeps local content and records a conflict backup during initial sync conflicts', async () => {
    const remotePath = createBareRemoteWithFiles({ 'note.md': 'remote\n' });
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);
    runGit(['init'], mindRoot);
    runGit(['checkout', '-B', 'main'], mindRoot);
    fs.writeFileSync(path.join(mindRoot, 'note.md'), 'local\n', 'utf-8');
    commitAll(mindRoot, 'local note');

    const { initSync, getSyncConflictBackupPath } = await importSync();
    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: remotePath,
      branch: 'main',
    })).resolves.toBeUndefined();

    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf-8')).toBe('local\n');
    expect(fs.readFileSync(getSyncConflictBackupPath(mindRoot, 'note.md'), 'utf-8')).toBe('remote\n');
    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf-8')).not.toContain('<<<<<<<');
    expect(runGit(['show', 'main:note.md'], remotePath)).toBe('remote');
    const state = JSON.parse(fs.readFileSync(path.join(mindosDir, 'sync-state.json'), 'utf-8'));
    expect(state.conflicts).toEqual([expect.objectContaining({ file: 'note.md' })]);
    expect(state.lastSync).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).sync.enabled).toBe(true);
  });

  it('keeps manual sync conflicts local until the user resolves them', async () => {
    const remotePath = createBareRemoteWithFiles({ 'note.md': 'base\n' });
    const mindRoot = path.join(tempDir, 'mind');
    runGit(['clone', remotePath, mindRoot], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], mindRoot);
    fs.writeFileSync(path.join(mindRoot, 'note.md'), 'local\n', 'utf-8');
    commitAll(mindRoot, 'local edit');

    const otherPath = path.join(tempDir, 'other');
    runGit(['clone', remotePath, otherPath], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], otherPath);
    fs.writeFileSync(path.join(otherPath, 'note.md'), 'remote\n', 'utf-8');
    commitAll(otherPath, 'remote edit');
    runGit(['push', 'origin', 'main'], otherPath);

    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot,
      sync: { enabled: true, provider: 'git', branch: 'main' },
    }), 'utf-8');

    const { manualSync, getSyncConflictBackupPath } = await importSync();
    expect(() => manualSync(mindRoot)).not.toThrow();

    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf-8')).toBe('local\n');
    expect(fs.readFileSync(getSyncConflictBackupPath(mindRoot, 'note.md'), 'utf-8')).toBe('remote\n');
    expect(runGit(['show', 'main:note.md'], remotePath)).toBe('remote');
    expect(runGit(['ls-tree', '-r', '--name-only', 'HEAD'], mindRoot).split('\n')).not.toContain('note.md.sync-conflict');
    expect(fs.readFileSync(path.join(mindRoot, '.gitignore'), 'utf-8')).toContain('*.sync-conflict');
    const state = JSON.parse(fs.readFileSync(path.join(mindosDir, 'sync-state.json'), 'utf-8'));
    expect(state.conflicts).toEqual([expect.objectContaining({ file: 'note.md' })]);
    expect(state.lastSync).toBeUndefined();
  });

  it('commits dirty local changes before pulling so autostash conflicts cannot be pushed', async () => {
    const remotePath = createBareRemoteWithFiles({ 'note.md': 'base\n' });
    const mindRoot = path.join(tempDir, 'mind');
    runGit(['clone', remotePath, mindRoot], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], mindRoot);
    fs.writeFileSync(path.join(mindRoot, 'note.md'), 'dirty local\n', 'utf-8');

    const otherPath = path.join(tempDir, 'other');
    runGit(['clone', remotePath, otherPath], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], otherPath);
    fs.writeFileSync(path.join(otherPath, 'note.md'), 'remote edit\n', 'utf-8');
    commitAll(otherPath, 'remote edit');
    runGit(['push', 'origin', 'main'], otherPath);

    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot,
      sync: { enabled: true, provider: 'git', branch: 'main' },
    }), 'utf-8');

    const { manualSync, getSyncConflictBackupPath } = await importSync();
    expect(() => manualSync(mindRoot)).not.toThrow();

    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf-8')).toBe('dirty local\n');
    expect(fs.readFileSync(getSyncConflictBackupPath(mindRoot, 'note.md'), 'utf-8')).toBe('remote edit\n');
    expect(runGit(['show', 'main:note.md'], remotePath)).toBe('remote edit');
    expect(runGit(['show', 'main:note.md'], remotePath)).not.toContain('<<<<<<<');
    expect(runGit(['show', 'HEAD:note.md'], mindRoot)).not.toContain('<<<<<<<');
    const state = JSON.parse(fs.readFileSync(path.join(mindosDir, 'sync-state.json'), 'utf-8'));
    expect(state.conflicts).toEqual([expect.objectContaining({
      file: 'note.md',
      localExists: true,
      remoteExists: true,
    })]);
    expect(state.lastSync).toBeUndefined();
  });

  it('records remote deletion conflicts so keep-remote can delete the local file later', async () => {
    const remotePath = createBareRemoteWithFiles({ 'note.md': 'base\n' });
    const mindRoot = path.join(tempDir, 'mind');
    runGit(['clone', remotePath, mindRoot], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], mindRoot);
    fs.writeFileSync(path.join(mindRoot, 'note.md'), 'local edit\n', 'utf-8');
    commitAll(mindRoot, 'local edit');

    const otherPath = path.join(tempDir, 'other');
    runGit(['clone', remotePath, otherPath], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], otherPath);
    fs.rmSync(path.join(otherPath, 'note.md'));
    commitAll(otherPath, 'remote delete');
    runGit(['push', 'origin', 'main'], otherPath);

    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot,
      sync: { enabled: true, provider: 'git', branch: 'main' },
    }), 'utf-8');

    const { manualSync, getSyncConflictBackupPath } = await importSync();
    expect(() => manualSync(mindRoot)).not.toThrow();

    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf-8')).toBe('local edit\n');
    expect(fs.existsSync(getSyncConflictBackupPath(mindRoot, 'note.md'))).toBe(false);
    expect(runGit(['ls-tree', '-r', '--name-only', 'main'], remotePath).split('\n').filter(Boolean)).not.toContain('note.md');
    const state = JSON.parse(fs.readFileSync(path.join(mindosDir, 'sync-state.json'), 'utf-8'));
    expect(state.conflicts).toEqual([expect.objectContaining({
      file: 'note.md',
      localExists: true,
      remoteExists: false,
    })]);
    expect(state.conflicts[0].noBackup).toBeUndefined();
    expect(state.lastSync).toBeUndefined();
  });

  it('records local deletion conflicts so keep-local can preserve the deletion later', async () => {
    const remotePath = createBareRemoteWithFiles({ 'note.md': 'base\n' });
    const mindRoot = path.join(tempDir, 'mind');
    runGit(['clone', remotePath, mindRoot], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], mindRoot);
    fs.rmSync(path.join(mindRoot, 'note.md'));
    commitAll(mindRoot, 'local delete');

    const otherPath = path.join(tempDir, 'other');
    runGit(['clone', remotePath, otherPath], tempDir);
    runGit(['checkout', '-B', 'main', 'origin/main'], otherPath);
    fs.writeFileSync(path.join(otherPath, 'note.md'), 'remote edit\n', 'utf-8');
    commitAll(otherPath, 'remote edit');
    runGit(['push', 'origin', 'main'], otherPath);

    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      mindRoot,
      sync: { enabled: true, provider: 'git', branch: 'main' },
    }), 'utf-8');

    const { manualSync, getSyncConflictBackupPath } = await importSync();
    expect(() => manualSync(mindRoot)).not.toThrow();

    expect(fs.existsSync(path.join(mindRoot, 'note.md'))).toBe(false);
    expect(fs.readFileSync(getSyncConflictBackupPath(mindRoot, 'note.md'), 'utf-8')).toBe('remote edit\n');
    expect(runGit(['show', 'main:note.md'], remotePath)).toBe('remote edit');
    const state = JSON.parse(fs.readFileSync(path.join(mindosDir, 'sync-state.json'), 'utf-8'));
    expect(state.conflicts).toEqual([expect.objectContaining({
      file: 'note.md',
      localExists: false,
      remoteExists: true,
    })]);
    expect(state.lastSync).toBeUndefined();
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

  it('rejects an approved HTTPS credential when credential verification fails', async () => {
    const calls: string[][] = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[], options?: { input?: string }) => {
      calls.push(args);
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'credential' && args[1] === 'approve') return '';
      if (args[0] === 'credential' && args[1] === 'fill') return 'protocol=https\nhost=example.com\nusername=oauth2\n\n';
      if (args[0] === 'credential' && args[1] === 'reject') {
        expect(options?.input).toContain('password=ghp_secret');
        return '';
      }
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

    expect(calls).toContainEqual(['credential', 'reject']);
  });

  it('stops a running daemon after sync is disabled in config', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const watcher = { on: vi.fn().mockReturnThis(), close };
    const watch = vi.fn(() => watcher);
    vi.doMock('chokidar', () => ({
      __esModule: true,
      default: { watch },
      watch,
    }));
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return {
        ...actual,
        execFileSync: vi.fn((_command: string, args: string[]) => {
          if (args[0] === 'remote' && args[1] === 'get-url') return 'https://example.com/mind.git\n';
          return '';
        }),
      };
    });
    const { startSyncDaemon, setSyncEnabled, stopSyncDaemon } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      sync: { enabled: true, provider: 'git', autoCommitInterval: 10, autoPullInterval: 60 },
    }), 'utf-8');

    const daemon = await startSyncDaemon(mindRoot) as { watcher: { close: () => unknown } };
    expect(daemon).not.toBeNull();
    const closeSpy = vi.spyOn(daemon.watcher, 'close');
    expect(close).not.toHaveBeenCalled();

    setSyncEnabled(false);
    await vi.advanceTimersByTimeAsync(5000);

    expect(closeSpy).toHaveBeenCalledOnce();
    stopSyncDaemon();
    vi.useRealTimers();
  });

  it('clears a pending daemon auto-commit when the daemon stops', async () => {
    vi.useFakeTimers();
    const calls: string[][] = [];
    let changeHandler: (() => void) | undefined;
    const close = vi.fn();
    const watcher = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'all') changeHandler = handler;
        return watcher;
      }),
      close,
    };
    const watch = vi.fn(() => watcher);
    vi.doMock('chokidar', () => ({
      __esModule: true,
      default: { watch },
      watch,
    }));
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return {
        ...actual,
        execFileSync: vi.fn((_command: string, args: string[]) => {
          calls.push(args);
          if (args[0] === 'remote' && args[1] === 'get-url') return 'https://example.com/mind.git\n';
          return '';
        }),
      };
    });
    const { startSyncDaemon, stopSyncDaemon } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      sync: { enabled: true, provider: 'git', autoCommitInterval: 10, autoPullInterval: 60 },
    }), 'utf-8');

    const daemon = await startSyncDaemon(mindRoot) as { watcher: { close: () => unknown; emit?: (...args: unknown[]) => unknown } };
    expect(daemon).not.toBeNull();
    const closeSpy = vi.spyOn(daemon.watcher, 'close');
    if (changeHandler) changeHandler();
    else daemon.watcher.emit?.('all', 'change', path.join(mindRoot, 'note.md'));
    stopSyncDaemon();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(closeSpy).toHaveBeenCalledOnce();
    expect(calls.some(args => args[0] === 'add')).toBe(false);
    vi.useRealTimers();
  });

  it('reloads daemon pull interval after sync interval config changes', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const watcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
    const watch = vi.fn(() => watcher);
    vi.doMock('chokidar', () => ({
      __esModule: true,
      default: { watch },
      watch,
    }));
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return {
        ...actual,
        execFileSync: vi.fn((_command: string, args: string[]) => {
          if (args[0] === 'remote' && args[1] === 'get-url') return 'https://example.com/mind.git\n';
          return '';
        }),
      };
    });
    const { startSyncDaemon, stopSyncDaemon } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      sync: { enabled: true, provider: 'git', autoCommitInterval: 10, autoPullInterval: 60 },
    }), 'utf-8');

    await startSyncDaemon(mindRoot);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

    fs.writeFileSync(configPath, JSON.stringify({
      sync: { enabled: true, provider: 'git', autoCommitInterval: 10, autoPullInterval: 120 },
    }), 'utf-8');
    await vi.advanceTimersByTimeAsync(5000);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 120_000);
    stopSyncDaemon();
    vi.useRealTimers();
  });

  it('deduplicates concurrent daemon starts for the same repository', async () => {
    vi.useFakeTimers();
    const calls: string[][] = [];
    const watcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
    const watch = vi.fn(() => watcher);
    vi.doMock('chokidar', () => ({
      __esModule: true,
      default: { watch },
      watch,
    }));
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return {
        ...actual,
        execFileSync: vi.fn((_command: string, args: string[]) => {
          calls.push(args);
          if (args[0] === 'remote' && args[1] === 'get-url') return 'https://example.com/mind.git\n';
          return '';
        }),
      };
    });
    const { startSyncDaemon, stopSyncDaemon } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      sync: { enabled: true, provider: 'git', autoCommitInterval: 10, autoPullInterval: 60 },
    }), 'utf-8');

    await Promise.all([startSyncDaemon(mindRoot), startSyncDaemon(mindRoot)]);

    expect(calls.filter(args => args[0] === 'remote' && args[1] === 'get-url')).toHaveLength(1);
    expect(watch.mock.calls.length).toBeLessThanOrEqual(1);
    stopSyncDaemon();
    vi.useRealTimers();
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

  it('does not infer a configured sync setup when no sync config exists', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({}), 'utf-8');
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') return 'git@example.com:mind/repo.git\n';
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { getSyncStatus } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    expect(getSyncStatus(mindRoot)).toEqual({ enabled: false });
  });

  it('counts dirty worktree files as local changes waiting to upload', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ sync: { enabled: true, provider: 'git' } }), 'utf-8');
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') return 'git@example.com:mind/repo.git\n';
      if (args[0] === 'rev-parse') return 'main\n';
      if (args[0] === 'rev-list') return '2\n';
      if (args[0] === 'status' && args[1] === '--porcelain=v1') return ' M note.md\n?? draft.md\n';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { getSyncStatus } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    expect(getSyncStatus(mindRoot).unpushed).toBe('4');
  });

  it('keeps the previous origin when reconfiguration fails connection validation', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      sync: { enabled: true, provider: 'git', remote: 'origin', branch: 'main' },
    }), 'utf-8');
    let origin = 'https://example.com/old.git';
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true\n';
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main\n';
      if (args[0] === 'check-ref-format') return 'main\n';
      if (args[0] === 'remote' && args[1] === 'get-url') return `${origin}\n`;
      if (args[0] === 'remote' && args[1] === 'add') {
        throw new Error('remote origin already exists');
      }
      if (args[0] === 'remote' && args[1] === 'set-url') {
        origin = args[3];
        return '';
      }
      if (args[0] === 'ls-remote') {
        const err = Object.assign(new Error('ls-remote failed'), {
          stderr: Buffer.from('fatal: repository not found\n'),
          stdout: Buffer.from(''),
        });
        throw err;
      }
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://example.com/bad.git',
      branch: 'main',
    })).rejects.toThrow('Remote not reachable');

    expect(origin).toBe('https://example.com/old.git');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).sync.remote).toBe('origin');
  });

  it('restores the previous branch when reconfiguration fails after switching branches', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      sync: { enabled: true, provider: 'git', remote: 'origin', branch: 'main' },
    }), 'utf-8');
    let currentBranch = 'main';
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true\n';
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return `${currentBranch}\n`;
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'remote' && args[1] === 'get-url') return 'https://example.com/old.git\n';
      if (args[0] === 'remote' && args[1] === 'add') throw new Error('remote origin already exists');
      if (args[0] === 'remote' && args[1] === 'set-url') return '';
      if (args[0] === 'checkout') {
        currentBranch = args[1] === '-b' ? args[2] : args[1];
        return '';
      }
      if (args[0] === 'ls-remote') {
        const err = Object.assign(new Error('ls-remote failed'), {
          stderr: Buffer.from('fatal: repository not found\n'),
          stdout: Buffer.from(''),
        });
        throw err;
      }
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://example.com/bad.git',
      branch: 'dev',
    })).rejects.toThrow('Remote not reachable');

    expect(currentBranch).toBe('main');
  });

  it('reports a clear branch error before initial pull when the requested branch is absent on a populated remote', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({}), 'utf-8');
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') throw new Error('not a repo');
      if (args[0] === 'init') return '';
      if (args[0] === 'checkout') return '';
      if (args[0] === 'check-ref-format') return 'main\n';
      if (args[0] === 'remote' && args[1] === 'add') return '';
      if (args[0] === 'ls-remote') return 'abc123\trefs/heads/master\n';
      if (args[0] === 'remote' && args[1] === 'remove') return '';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot, { recursive: true });

    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: 'https://example.com/repo.git',
      branch: 'main',
    })).rejects.toThrow('Branch "main" was not found on the remote');

    expect(execFileSyncMock).not.toHaveBeenCalledWith('git', expect.arrayContaining(['pull']), expect.anything());
  });

  it('accepts ssh protocol remotes and restores protected gitignore entries during init', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({}), 'utf-8');
    const lsRemoteOptions: Array<{ env?: Record<string, string> }> = [];
    const execFileSyncMock = vi.fn((_command: string, args: string[], options?: { env?: Record<string, string> }) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') throw new Error('not a repo');
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (args[0] === 'ls-remote') {
        lsRemoteOptions.push(options ?? {});
        return '';
      }
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { initSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot, { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.gitignore'), 'node_modules/\n', 'utf-8');

    await expect(initSync(mindRoot, {
      nonInteractive: true,
      remote: 'ssh://git@example.com/mind/repo.git',
      branch: 'main',
    })).resolves.toBeUndefined();

    expect(execFileSyncMock).toHaveBeenCalledWith('git', ['remote', 'add', 'origin', 'ssh://git@example.com/mind/repo.git'], expect.anything());
    expect(lsRemoteOptions[0]?.env?.GIT_SSH_COMMAND).toContain('BatchMode=yes');
    const gitignore = fs.readFileSync(path.join(mindRoot, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('*.sync-conflict');
    expect(gitignore).toContain('INSTRUCTION.md');
  });

  it('keeps manual sync failed when pull cannot read the remote and no conflict was produced', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ sync: { enabled: true, provider: 'git' } }), 'utf-8');
    const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') return 'git@example.com:mind/repo.git\n';
      if (args[0] === 'pull') {
        const err = Object.assign(new Error('pull failed'), {
          stderr: Buffer.from('fatal: no tracking information\n'),
          stdout: Buffer.from(''),
        });
        throw err;
      }
      if (args[0] === 'diff' && args.includes('--diff-filter=U')) return '';
      if (args[0] === 'status') return '';
      if (args[0] === 'push') return '';
      return '';
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFileSync: execFileSyncMock };
    });
    const { manualSync } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(path.join(mindRoot, '.git'), { recursive: true });

    expect(() => manualSync(mindRoot)).toThrow('Pull failed: fatal: no tracking information');
    expect(execFileSyncMock).not.toHaveBeenCalledWith('git', expect.arrayContaining(['push']), expect.anything());
    const state = JSON.parse(fs.readFileSync(path.join(mindosDir, 'sync-state.json'), 'utf-8'));
    expect(state.lastError).toBe('Pull failed: fatal: no tracking information');
  });

  it('does not keep the legacy allow-empty conflict commit fallback', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'packages/mindos/bin/lib/sync.js'), 'utf-8');

    expect(source).not.toContain('--allow-empty');
  });

  it('uses hidden input for interactive HTTPS sync tokens', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'packages/mindos/bin/lib/sync.js'), 'utf-8');

    expect(source).toContain("await import('./channel-prompts.js')");
    expect(source).toContain('promptHidden');
    expect(source).not.toContain("token = (await ask(`${bold('Access Token')}");
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

  it('does not clear an old sync lock while its owner process is still alive', async () => {
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
      operation: 'slow-init',
      startedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      token: 'live-owner',
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
