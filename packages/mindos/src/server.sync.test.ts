import {
  execFileSync
} from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import {
  tmpdir
} from 'node:os';
import {
  join
} from 'node:path';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  getServerSyncLockPath,
  handleSyncGet,
  handleSyncPost,
  sanitizeGitEnv
} from './server.js';

// Never inherit GIT_DIR / GIT_WORK_TREE etc.: when this suite runs from a git
// hook (pre-push), those vars point at the real repository and every add/commit
// below would silently land there instead of the temp repo (real incident:
// "seed remote" commits destroyed the development worktree).
function testGitEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  ) as NodeJS.ProcessEnv;
  env.GIT_AUTHOR_NAME = 'MindOS Test';
  env.GIT_AUTHOR_EMAIL = 'mindos-test@example.com';
  env.GIT_COMMITTER_NAME = 'MindOS Test';
  env.GIT_COMMITTER_EMAIL = 'mindos-test@example.com';
  return env;
}

function runTestGit(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    input,
    encoding: 'utf-8',
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    env: testGitEnv(),
  }).trim();
}

function commitAllTestGit(cwd: string, message: string): void {
  runTestGit(cwd, ['add', '-A']);
  runTestGit(cwd, ['commit', '-m', message]);
}

describe('MindOS server contract: sync', () => {
  it('handles sync status and actions through product-owned operations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    mkdirSync(join(mindRoot, '..notes'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote');
    writeFileSync(join(mindRoot, '..notes', 'note.md'), 'dotted local');
    writeFileSync(join(mindRoot, '..notes', 'note.md.sync-conflict'), 'dotted remote');

    let config: Record<string, any> = {
      mindRoot,
      sync: { enabled: true, provider: 'git', autoCommitInterval: 45, autoPullInterval: 600 },
    };
    let state: Record<string, any> = {
      lastSync: '2026-05-09T10:00:00Z',
      conflicts: [{ file: 'note.md' }],
    };
    const cliCalls: Array<{ args: string[]; timeoutMs?: number; envOverrides?: Record<string, string | undefined> }> = [];
    const daemonCalls: Array<{ action: string; mindRoot?: string }> = [];
    const services = {
      readConfig: () => config,
      writeConfig: (next: Record<string, any>) => { config = next; },
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      isGitRepo: () => true,
      getRemoteUrl: () => 'https://oauth2:ghp_secret_token@example.com/mind/repo.git',
      getBranch: () => 'main',
      getUnpushedCount: () => '2',
      syncLockDir: join(root, 'locks'),
      runCli: async (args: string[], timeoutMs?: number, envOverrides?: Record<string, string | undefined>) => {
        cliCalls.push({ args, timeoutMs, envOverrides });
      },
      syncDaemon: {
        restart: (root: string) => { daemonCalls.push({ action: 'restart', mindRoot: root }); },
        reconfigure: (root: string) => { daemonCalls.push({ action: 'reconfigure', mindRoot: root }); },
        stop: () => { daemonCalls.push({ action: 'stop' }); },
      },
    };

    const syncStatus = await handleSyncGet(services);
    expect(syncStatus).toMatchObject({
      status: 200,
      body: {
        enabled: true,
        remote: 'https://example.com/mind/repo.git',
        branch: 'main',
        unpushed: '2',
        conflicts: [{ file: 'note.md' }],
      },
    });
    expect(JSON.stringify(syncStatus.body)).not.toContain('ghp_secret_token');

    await expect(handleSyncPost({ action: 'init', remote: 'https://example.com/repo.git', branch: 'dev', token: 'tok' }, services)).resolves.toMatchObject({
      status: 200,
      body: { success: true, message: 'Sync initialized' },
    });
    expect(cliCalls[0]).toEqual({
      args: ['sync', 'init', '--non-interactive', '--remote', 'https://example.com/repo.git', '--branch', 'dev'],
      timeoutMs: 120000,
      envOverrides: { MINDOS_SYNC_TOKEN: 'tok' },
    });
    expect(cliCalls[0].args).not.toContain('tok');
    expect(daemonCalls).toContainEqual({ action: 'restart', mindRoot });

    await expect(handleSyncPost({ action: 'init', remote: 'https://oauth2:ghp_secret@example.com/repo.git', branch: 'main' }, services)).resolves.toMatchObject({
      status: 200,
      body: { success: true, message: 'Sync initialized' },
    });
    expect(cliCalls[1]).toEqual({
      args: ['sync', 'init', '--non-interactive', '--remote', 'https://example.com/repo.git', '--branch', 'main'],
      timeoutMs: 120000,
      envOverrides: { MINDOS_SYNC_TOKEN: 'ghp_secret' },
    });
    expect(JSON.stringify(cliCalls[1].args)).not.toContain('ghp_secret');

    await expect(handleSyncPost({ action: 'init', remote: 'https://alice@example.com/repo.git', branch: 'main' }, services)).resolves.toMatchObject({
      status: 200,
      body: { success: true, message: 'Sync initialized' },
    });
    expect(cliCalls[2]).toEqual({
      args: ['sync', 'init', '--non-interactive', '--remote', 'https://example.com/repo.git', '--branch', 'main'],
      timeoutMs: 120000,
      envOverrides: undefined,
    });

    await expect(handleSyncPost({ action: 'init', remote: 'ssh://git@example.com/mind/repo.git', branch: 'main' }, services)).resolves.toMatchObject({
      status: 200,
      body: { success: true, message: 'Sync initialized' },
    });
    expect(cliCalls[3]).toEqual({
      args: ['sync', 'init', '--non-interactive', '--remote', 'ssh://git@example.com/mind/repo.git', '--branch', 'main'],
      timeoutMs: 120000,
      envOverrides: undefined,
    });

    await expect(handleSyncPost({ action: 'init', remote: 'https://example.com/repo.git', branch: 'bad branch' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid branch name' },
    });
    expect(cliCalls).toHaveLength(4);

    expect(await handleSyncPost({ action: 'update-intervals', autoCommitInterval: 60 }, services)).toMatchObject({
      status: 200,
      body: { autoCommitInterval: 60, autoPullInterval: 600 },
    });
    expect(config.sync.autoCommitInterval).toBe(60);
    expect(daemonCalls).toContainEqual({ action: 'reconfigure', mindRoot });

    expect(await handleSyncPost({ action: 'off' }, services)).toMatchObject({
      status: 200,
      body: { ok: true, enabled: false },
    });
    expect(config.sync.enabled).toBe(false);
    expect(daemonCalls).toContainEqual({ action: 'stop' });

    await expect(handleSyncGet(services)).resolves.toMatchObject({
      status: 200,
      body: {
        enabled: false,
        configured: true,
        remote: 'https://example.com/mind/repo.git',
        branch: 'main',
      },
    });

    expect(await handleSyncPost({ action: 'on' }, services)).toMatchObject({
      status: 200,
      body: { ok: true, enabled: true },
    });
    expect(config.sync.enabled).toBe(true);
    expect(daemonCalls).toContainEqual({ action: 'restart', mindRoot });

    config.sync.enabled = false;
    services.getRemoteUrl = () => null;
    await expect(handleSyncGet(services)).resolves.toMatchObject({
      status: 200,
      body: {
        enabled: false,
        configured: true,
        needsSetup: true,
        remote: '(not configured)',
        conflicts: [{ file: 'note.md' }],
      },
    });
    services.getRemoteUrl = () => 'https://oauth2:ghp_secret_token@example.com/mind/repo.git';

    const gitignoreSave = await handleSyncPost({ action: 'gitignore-save', content: 'node_modules\n' }, services);
    expect(gitignoreSave).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect((gitignoreSave.body as { content?: string }).content).toContain('*.sync-conflict');
    expect((gitignoreSave.body as { content?: string }).content).toContain('INSTRUCTION.md');
    const savedGitignore = readFileSync(join(mindRoot, '.gitignore'), 'utf-8');
    expect(savedGitignore).toContain('node_modules');
    expect(savedGitignore).toContain('*.sync-conflict');
    expect(savedGitignore).toContain('INSTRUCTION.md');

    expect(await handleSyncPost({ action: 'conflict-preview', remote: 'note.md' }, services)).toMatchObject({
      status: 200,
      body: { local: 'local', remote: 'remote' },
    });
    expect(await handleSyncPost({ action: 'conflict-preview', remote: '..notes/note.md' }, services)).toMatchObject({
      status: 200,
      body: { local: 'dotted local', remote: 'dotted remote' },
    });
    expect(await handleSyncPost({ action: 'resolve-conflict', remote: '../outside.md' }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid file path' },
    });
    expect(await handleSyncPost({ action: 'resolve-conflict', remote: 'note.md', branch: 'delete-everything' }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid conflict resolution strategy' },
    });
    expect(await handleSyncPost({ action: 'conflict-preview', remote: '..\\outside.md' }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid file path' },
    });
    expect(await handleSyncPost({ action: 'update-intervals', autoCommitInterval: 1 }, services)).toMatchObject({
      status: 400,
      body: { error: 'autoCommitInterval must be an integer between 10 and 300 seconds' },
    });
  });

  it('stops tracking files newly excluded through .gitignore while keeping local copies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-gitignore-tracked-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(mindRoot, { recursive: true });
    runTestGit(mindRoot, ['init']);
    runTestGit(mindRoot, ['checkout', '-B', 'main']);
    mkdirSync(join(mindRoot, 'Folder Secret'), { recursive: true });
    writeFileSync(join(mindRoot, 'secret.md'), 'private', 'utf-8');
    writeFileSync(join(mindRoot, 'Folder Secret', 'space note.md'), 'private nested', 'utf-8');
    writeFileSync(join(mindRoot, 'public.md'), 'public', 'utf-8');
    commitAllTestGit(mindRoot, 'initial notes');

    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      syncLockDir: join(root, 'locks'),
    };

    const response = await handleSyncPost({ action: 'gitignore-save', content: 'secret.md\nFolder Secret/\n' }, services);

    expect(response).toMatchObject({
      status: 200,
      body: {
        ok: true,
        stoppedTracking: ['Folder Secret/space note.md', 'secret.md'],
        syncNeeded: true,
      },
    });
    expect(readFileSync(join(mindRoot, 'secret.md'), 'utf-8')).toBe('private');
    expect(readFileSync(join(mindRoot, 'Folder Secret', 'space note.md'), 'utf-8')).toBe('private nested');
    expect(runTestGit(mindRoot, ['ls-files', '--', 'secret.md'])).toBe('');
    expect(runTestGit(mindRoot, ['ls-files', '--', 'Folder Secret/space note.md'])).toBe('');
    expect(runTestGit(mindRoot, ['ls-files', '--', 'public.md'])).toBe('public.md');
    const status = runTestGit(mindRoot, ['status', '--porcelain=v1']);
    expect(status).toContain('D  secret.md');
    expect(status).toContain('D  "Folder Secret/space note.md"');
  });

  it('keeps .gitignore tracked even when a broad ignore pattern matches it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-gitignore-self-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(mindRoot, { recursive: true });
    runTestGit(mindRoot, ['init']);
    runTestGit(mindRoot, ['checkout', '-B', 'main']);
    writeFileSync(join(mindRoot, '.gitignore'), '# old\n', 'utf-8');
    writeFileSync(join(mindRoot, 'public.md'), 'public', 'utf-8');
    commitAllTestGit(mindRoot, 'initial notes');

    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      syncLockDir: join(root, 'locks'),
    };

    const response = await handleSyncPost({ action: 'gitignore-save', content: '*\n' }, services);

    expect(response).toMatchObject({
      status: 200,
      body: {
        ok: true,
        stoppedTracking: ['public.md'],
        syncNeeded: true,
      },
    });
    expect(runTestGit(mindRoot, ['ls-files', '--', '.gitignore'])).toBe('.gitignore');
    expect(runTestGit(mindRoot, ['ls-files', '--', 'public.md'])).toBe('');
  });

  it('does not clear a conflict when keep-remote is requested without a remote backup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-missing-backup-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md' }],
      lastError: 'previous',
    };
    let writeStateCalled = false;
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => {
        writeStateCalled = true;
        state = next;
      },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 409,
      body: { error: 'Remote conflict backup is missing' },
    });
    expect(readFileSync(join(mindRoot, 'note.md'), 'utf-8')).toBe('local');
    expect(state).toEqual({ conflicts: [{ file: 'note.md' }], lastError: 'previous' });
    expect(writeStateCalled).toBe(false);
  });

  it('accepts a remote deletion conflict when keep-remote is selected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-remote-delete-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local version', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md', localExists: true, remoteExists: false }],
      lastError: 'previous',
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'conflict-preview', file: 'note.md' }, services)).toMatchObject({
      status: 200,
      body: { local: 'local version', remote: '' },
    });
    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(existsSync(join(mindRoot, 'note.md'))).toBe(false);
    expect(state).toEqual({ conflicts: [], lastError: 'previous' });
  });

  it('preserves a local deletion conflict when keep-local is selected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-local-delete-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'remote currently applied', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote version', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md', localExists: false, remoteExists: true }],
      lastError: 'previous',
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'conflict-preview', file: 'note.md' }, services)).toMatchObject({
      status: 200,
      body: { local: '', remote: 'remote version' },
    });
    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-local' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(existsSync(join(mindRoot, 'note.md'))).toBe(false);
    expect(existsSync(join(mindRoot, 'note.md.sync-conflict'))).toBe(false);
    expect(state).toEqual({ conflicts: [], lastError: 'previous' });
  });

  it('replaces the local conflict file when keep-remote succeeds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-keep-remote-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local version', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote version', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [
        { file: 'note.md', time: '2026-06-05T10:00:00.000Z' },
        { file: 'other.md' },
      ],
      lastError: 'previous',
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(readFileSync(join(mindRoot, 'note.md'), 'utf-8')).toBe('remote version');
    expect(existsSync(join(mindRoot, 'note.md.sync-conflict'))).toBe(false);
    expect(state).toEqual({
      conflicts: [{ file: 'other.md' }],
      lastError: 'previous',
    });
  });

  it('commits and pushes the final resolved conflict so the remote reflects the chosen version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-resolve-push-'));
    const remotePath = join(root, 'remote.git');
    const seedPath = join(root, 'seed');
    const mindRoot = join(root, 'mind');
    runTestGit(root, ['init', '--bare', remotePath]);
    mkdirSync(seedPath, { recursive: true });
    runTestGit(seedPath, ['init']);
    runTestGit(seedPath, ['checkout', '-B', 'main']);
    writeFileSync(join(seedPath, 'note.md'), 'base\n', 'utf-8');
    commitAllTestGit(seedPath, 'seed');
    runTestGit(seedPath, ['remote', 'add', 'origin', remotePath]);
    runTestGit(seedPath, ['push', '-u', 'origin', 'main']);
    runTestGit(root, ['clone', remotePath, mindRoot]);
    runTestGit(mindRoot, ['checkout', '-B', 'main', 'origin/main']);
    runTestGit(mindRoot, ['branch', '--set-upstream-to=origin/main', 'main']);
    writeFileSync(join(mindRoot, 'note.md'), 'local\n', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote chosen\n', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md', localExists: true, remoteExists: true }],
      lastError: 'previous',
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 200,
      body: { ok: true, uploaded: true },
    });
    expect(readFileSync(join(mindRoot, 'note.md'), 'utf-8')).toBe('remote chosen\n');
    expect(existsSync(join(mindRoot, 'note.md.sync-conflict'))).toBe(false);
    expect(state.conflicts).toEqual([]);
    expect(state.lastError).toBeNull();
    expect(state.lastSync).toEqual(expect.any(String));
    expect(runTestGit(remotePath, ['show', 'main:note.md'])).toBe('remote chosen');
  });

  it('does not commit unrelated staged files when the final conflict is resolved', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-resolve-scoped-'));
    const remotePath = join(root, 'remote.git');
    const seedPath = join(root, 'seed');
    const mindRoot = join(root, 'mind');
    runTestGit(root, ['init', '--bare', remotePath]);
    mkdirSync(seedPath, { recursive: true });
    runTestGit(seedPath, ['init']);
    runTestGit(seedPath, ['checkout', '-B', 'main']);
    writeFileSync(join(seedPath, 'note.md'), 'base\n', 'utf-8');
    writeFileSync(join(seedPath, 'unrelated.md'), 'base unrelated\n', 'utf-8');
    commitAllTestGit(seedPath, 'seed');
    runTestGit(seedPath, ['remote', 'add', 'origin', remotePath]);
    runTestGit(seedPath, ['push', '-u', 'origin', 'main']);
    runTestGit(root, ['clone', remotePath, mindRoot]);
    runTestGit(mindRoot, ['checkout', '-B', 'main', 'origin/main']);
    runTestGit(mindRoot, ['branch', '--set-upstream-to=origin/main', 'main']);
    writeFileSync(join(mindRoot, 'unrelated.md'), 'private staged change\n', 'utf-8');
    runTestGit(mindRoot, ['add', 'unrelated.md']);
    writeFileSync(join(mindRoot, 'note.md'), 'local\n', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote chosen\n', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md', localExists: true, remoteExists: true }],
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 200,
      body: { ok: true, uploaded: true },
    });
    expect(runTestGit(remotePath, ['show', 'main:note.md'])).toBe('remote chosen');
    expect(runTestGit(remotePath, ['show', 'main:unrelated.md'])).toBe('base unrelated');
    expect(runTestGit(mindRoot, ['status', '--porcelain=v1', '--', 'unrelated.md'])).toBe('M  unrelated.md');
  });

  it('defers upload after conflict resolution when older local commits would also be pushed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-resolve-defer-push-'));
    const remotePath = join(root, 'remote.git');
    const seedPath = join(root, 'seed');
    const mindRoot = join(root, 'mind');
    runTestGit(root, ['init', '--bare', remotePath]);
    mkdirSync(seedPath, { recursive: true });
    runTestGit(seedPath, ['init']);
    runTestGit(seedPath, ['checkout', '-B', 'main']);
    writeFileSync(join(seedPath, 'note.md'), 'base\n', 'utf-8');
    writeFileSync(join(seedPath, 'unrelated.md'), 'base unrelated\n', 'utf-8');
    commitAllTestGit(seedPath, 'seed');
    runTestGit(seedPath, ['remote', 'add', 'origin', remotePath]);
    runTestGit(seedPath, ['push', '-u', 'origin', 'main']);
    runTestGit(root, ['clone', remotePath, mindRoot]);
    runTestGit(mindRoot, ['checkout', '-B', 'main', 'origin/main']);
    runTestGit(mindRoot, ['branch', '--set-upstream-to=origin/main', 'main']);
    writeFileSync(join(mindRoot, 'unrelated.md'), 'earlier local commit\n', 'utf-8');
    commitAllTestGit(mindRoot, 'local unrelated work');
    writeFileSync(join(mindRoot, 'note.md'), 'local\n', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote chosen\n', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md', localExists: true, remoteExists: true }],
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 200,
      body: {
        ok: true,
        uploaded: false,
        warning: expect.stringContaining('upload is waiting'),
      },
    });
    expect(readFileSync(join(mindRoot, 'note.md'), 'utf-8')).toBe('remote chosen\n');
    expect(runTestGit(mindRoot, ['rev-list', '--count', '@{u}..HEAD'])).toBe('2');
    expect(runTestGit(remotePath, ['show', 'main:note.md'])).toBe('base');
    expect(runTestGit(remotePath, ['show', 'main:unrelated.md'])).toBe('base unrelated');
    expect(state.lastError).toContain('upload is waiting');
  });

  it('keeps upload failure visible after the final conflict is resolved locally', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-resolve-push-fail-'));
    const remotePath = join(root, 'remote.git');
    const mindRoot = join(root, 'mind');
    mkdirSync(mindRoot, { recursive: true });
    runTestGit(root, ['init', '--bare', remotePath]);
    runTestGit(mindRoot, ['init']);
    runTestGit(mindRoot, ['checkout', '-B', 'main']);
    writeFileSync(join(mindRoot, 'note.md'), 'base\n', 'utf-8');
    commitAllTestGit(mindRoot, 'base');
    runTestGit(mindRoot, ['remote', 'add', 'origin', remotePath]);
    runTestGit(mindRoot, ['push', '-u', 'origin', 'main']);
    rmSync(remotePath, { recursive: true, force: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local\n', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote chosen\n', 'utf-8');

    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md', localExists: true, remoteExists: true }],
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 200,
      body: {
        ok: true,
        uploaded: false,
        warning: expect.stringContaining('Conflict resolved locally, but upload failed'),
      },
    });
    expect(readFileSync(join(mindRoot, 'note.md'), 'utf-8')).toBe('remote chosen\n');
    expect(state.conflicts).toEqual([]);
    expect(state.lastError).toContain('Conflict resolved locally, but upload failed');
    expect(state.lastErrorTime).toEqual(expect.any(String));
  });

  it('normalizes legacy sync conflicts before returning and resolving them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-legacy-conflicts-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local', 'utf-8');

    let state: Record<string, any> = {
      conflicts: ['note.md', { file: 'second.md', time: 'bad-date' }, { missing: true }],
    };
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      isGitRepo: () => true,
      getRemoteUrl: () => 'git@example.com:mind/repo.git',
      getBranch: () => 'main',
      getUnpushedCount: () => '0',
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncGet(services)).toMatchObject({
      status: 200,
      body: {
        conflicts: [{ file: 'note.md' }, { file: 'second.md', time: 'bad-date' }],
      },
    });

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-local' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(state.conflicts).toEqual([{ file: 'second.md', time: 'bad-date' }]);
  });

  it('reports a missing remote backup when previewing a conflict', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-preview-missing-backup-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local', 'utf-8');

    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'conflict-preview', file: 'note.md' }, services)).toMatchObject({
      status: 409,
      body: { error: 'Remote conflict backup is missing' },
    });
  });

  it('reads a BOM-prefixed sync config instead of reporting setup as unconfigured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-bom-config-'));
    const mindRoot = join(root, 'mind');
    const configPath = join(root, 'config.json');
    const statePath = join(root, 'sync-state.json');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(configPath, `\uFEFF${JSON.stringify({ mindRoot, sync: { enabled: true, provider: 'git' } })}`, 'utf-8');
    writeFileSync(statePath, JSON.stringify({ lastSync: '2026-05-09T10:00:00Z' }), 'utf-8');

    expect(await handleSyncGet({
      configPath,
      statePath,
      isGitRepo: () => true,
      getRemoteUrl: () => 'git@example.com:mind/repo.git',
      getBranch: () => 'main',
      getUnpushedCount: () => '0',
    })).toMatchObject({
      status: 200,
      body: {
        enabled: true,
        remote: 'git@example.com:mind/repo.git',
        lastSync: '2026-05-09T10:00:00Z',
      },
    });
  });

  it('reports and backs up a malformed sync config during reset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-bad-config-'));
    const configPath = join(root, 'config.json');
    const statePath = join(root, 'sync-state.json');
    writeFileSync(configPath, '{ "mindRoot": "/tmp/mind", "sync": ', 'utf-8');
    writeFileSync(statePath, JSON.stringify({ conflicts: ['note.md'] }), 'utf-8');

    expect(await handleSyncGet({ configPath, statePath })).toMatchObject({
      status: 200,
      body: {
        enabled: false,
        configured: true,
        needsSetup: true,
        conflicts: [{ file: 'note.md' }],
        lastError: expect.stringContaining('MindOS config file could not be read'),
      },
    });

    expect(await handleSyncPost({ action: 'reset' }, { configPath, statePath })).toMatchObject({
      status: 200,
      body: { ok: true, enabled: false },
    });
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({});
    expect(JSON.parse(readFileSync(statePath, 'utf-8'))).toEqual({});
    expect(readdirSync(root).some(name => name.startsWith('config.json.broken-'))).toBe(true);
  });

  it('returns an unconfigured sync status after reset instead of inferring paused from a leftover origin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-reset-origin-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });

    let config: Record<string, any> = {
      mindRoot,
      sync: { enabled: true, provider: 'git' },
    };
    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md' }],
      lastError: 'previous',
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: Record<string, any>) => { config = next; },
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      isGitRepo: () => true,
      getRemoteUrl: () => 'git@example.com:mind/repo.git',
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'reset' }, services)).toMatchObject({
      status: 200,
      body: { ok: true, enabled: false },
    });
    expect(config.sync).toBeUndefined();
    expect(state).toEqual({});

    expect(await handleSyncGet(services)).toMatchObject({
      status: 200,
      body: { enabled: false },
    });
    expect(await handleSyncGet(services)).not.toMatchObject({
      body: { configured: true },
    });
  });

  it('preserves previous sync context when enabled sync is broken', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-broken-context-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });

    const services = {
      readConfig: () => ({
        mindRoot,
        sync: { enabled: true, provider: 'git', autoCommitInterval: 45, autoPullInterval: 600 },
      }),
      readState: () => ({
        lastSync: '2026-05-09T10:00:00Z',
        lastPull: '2026-05-09T09:59:00Z',
        conflicts: ['note.md'],
        lastError: 'previous failure',
      }),
      isGitRepo: () => true,
      getRemoteUrl: () => null,
      getBranch: () => 'main',
      syncLockDir: join(root, 'locks'),
    };

    await expect(handleSyncGet(services)).resolves.toMatchObject({
      status: 200,
      body: {
        enabled: true,
        needsSetup: true,
        remote: '(not configured)',
        branch: 'main',
        lastSync: '2026-05-09T10:00:00Z',
        lastPull: '2026-05-09T09:59:00Z',
        conflicts: [{ file: 'note.md' }],
        lastError: 'previous failure',
        autoCommitInterval: 45,
        autoPullInterval: 600,
      },
    });
  });

  it('includes dirty worktree files in product sync status unpushed count', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-dirty-status-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(mindRoot, { recursive: true });
    execFileSync('git', ['init'], { cwd: mindRoot, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/mind/repo.git'], { cwd: mindRoot, stdio: 'pipe' });
    writeFileSync(join(mindRoot, 'note.md'), 'dirty local change', 'utf-8');

    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      readState: () => ({}),
    };

    expect(await handleSyncGet(services)).toMatchObject({
      status: 200,
      body: {
        enabled: true,
        unpushed: '1',
      },
    });
  });

  it('returns 423 without mutating direct sync file operations while the sync lock is owned', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-lock-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, '.gitignore'), 'original\n', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md'), 'local', 'utf-8');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote', 'utf-8');

    let config: Record<string, any> = {
      mindRoot,
      sync: { enabled: true, provider: 'git' },
    };
    let state: Record<string, any> = {
      conflicts: [{ file: 'note.md' }],
      lastError: 'previous',
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: Record<string, any>) => { config = next; },
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      isGitRepo: () => true,
      getRemoteUrl: () => 'git@example.com:mind/repo.git',
      syncLockDir: join(root, 'locks'),
    };
    const lockPath = getServerSyncLockPath(mindRoot, services);
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({
      pid: process.pid,
      operation: 'daemon-pull',
      startedAt: new Date().toISOString(),
      token: 'owner-token',
    }), 'utf-8');

    expect(await handleSyncPost({ action: 'gitignore-save', content: 'next\n' }, services)).toMatchObject({
      status: 423,
      body: { error: expect.stringContaining('SYNC_LOCKED') },
    });
    expect(readFileSync(join(mindRoot, '.gitignore'), 'utf-8')).toBe('original\n');

    expect(await handleSyncPost({ action: 'resolve-conflict', file: 'note.md', strategy: 'keep-remote' }, services)).toMatchObject({
      status: 423,
      body: { error: expect.stringContaining('owner=daemon-pull') },
    });
    expect(readFileSync(join(mindRoot, 'note.md'), 'utf-8')).toBe('local');
    expect(readFileSync(join(mindRoot, 'note.md.sync-conflict'), 'utf-8')).toBe('remote');
    expect(state).toEqual({ conflicts: [{ file: 'note.md' }], lastError: 'previous' });

    expect(await handleSyncPost({ action: 'off' }, services)).toMatchObject({
      status: 423,
      body: { error: expect.stringContaining('SYNC_LOCKED') },
    });
    expect(config.sync).toEqual({ enabled: true, provider: 'git' });

    expect(await handleSyncPost({ action: 'update-intervals', autoCommitInterval: 60 }, services)).toMatchObject({
      status: 423,
      body: { error: expect.stringContaining('SYNC_LOCKED') },
    });
    expect(config.sync).toEqual({ enabled: true, provider: 'git' });

    expect(await handleSyncPost({ action: 'reset' }, services)).toMatchObject({
      status: 423,
      body: { error: expect.stringContaining('SYNC_LOCKED') },
    });
    expect(config.sync).toEqual({ enabled: true, provider: 'git' });
    expect(state).toEqual({ conflicts: [{ file: 'note.md' }], lastError: 'previous' });
  });

  it('maps CLI sync lock failures to HTTP 423 without leaking ANSI codes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-cli-lock-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true, provider: 'git' } }),
      isGitRepo: () => true,
      runCli: async () => {
        throw new Error('\x1B[31mSYNC_LOCKED: Sync is already running (owner=daemon-pull)\x1B[39m');
      },
    };

    expect(await handleSyncPost({ action: 'now' }, services)).toMatchObject({
      status: 423,
      body: { error: 'SYNC_LOCKED: Sync is already running (owner=daemon-pull)' },
    });
  });

  it('allows sync reset when the knowledge root is missing', async () => {
    let config: Record<string, any> = {
      sync: { enabled: true, provider: 'git' },
    };
    let state: Record<string, any> = {
      lastError: 'Git repository not found',
      conflicts: [{ file: 'note.md' }],
    };
    const daemonStop = vi.fn();
    const services = {
      readConfig: () => config,
      writeConfig: (next: Record<string, any>) => { config = next; },
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      syncDaemon: { stop: daemonStop },
    };

    expect(await handleSyncPost({ action: 'reset' }, services)).toMatchObject({
      status: 200,
      body: { ok: true, enabled: false },
    });
    expect(config.sync).toBeUndefined();
    expect(state).toEqual({});
    expect(daemonStop).toHaveBeenCalledOnce();
  });

  it('rejects sync file operations through symlinks outside mindRoot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-symlink-root-'));
    const mindRoot = join(root, 'mind');
    const outside = mkdtempSync(join(tmpdir(), 'mindos-sync-symlink-outside-'));
    mkdirSync(mindRoot, { recursive: true });
    writeFileSync(join(outside, '.gitignore'), 'outside\n', 'utf-8');
    writeFileSync(join(outside, 'note.md'), 'outside local', 'utf-8');
    writeFileSync(join(outside, 'note.md.sync-conflict'), 'outside remote', 'utf-8');
    symlinkSync(join(outside, '.gitignore'), join(mindRoot, '.gitignore'), 'file');
    symlinkSync(outside, join(mindRoot, 'Linked'), 'dir');

    const services = {
      readConfig: () => ({ mindRoot, sync: { enabled: true } }),
      writeConfig: () => {},
      readState: () => ({ conflicts: [{ file: 'Linked/note.md' }] }),
      writeState: () => {},
      syncLockDir: join(root, 'locks'),
    };

    expect(await handleSyncPost({ action: 'gitignore-save', content: 'node_modules\n' }, services)).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
    expect(readFileSync(join(outside, '.gitignore'), 'utf-8')).toBe('outside\n');

    expect(await handleSyncPost({ action: 'gitignore-get' }, services)).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });

    expect(await handleSyncPost({ action: 'conflict-preview', remote: 'Linked/note.md' }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid file path' },
    });
    expect(await handleSyncPost({ action: 'resolve-conflict', remote: 'Linked/note.md', branch: 'keep-remote' }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid file path' },
    });
    expect(readFileSync(join(outside, 'note.md'), 'utf-8')).toBe('outside local');
  });

  it('reads sync git metadata through argv-safe git commands', () => {
    const source = readFileSync(join(__dirname, 'server', 'handlers', 'sync.ts'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("execFileSync('git', args");
    expect(source).toContain("runGit(cwd, ['remote', 'get-url', 'origin'])");
    expect(source).toContain("runGit(cwd, ['rev-list', '--count', '@{u}..HEAD'])");
  });

  it('sanitizeGitEnv drops hook-exported repo-targeting vars but keeps user git config', () => {
    const sanitized = sanitizeGitEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      GIT_DIR: '/real/repo/.git',
      GIT_WORK_TREE: '/real/repo',
      GIT_INDEX_FILE: '/real/repo/.git/index',
      GIT_OBJECT_DIRECTORY: '/real/repo/.git/objects',
      GIT_ALTERNATE_OBJECT_DIRECTORIES: '/alt',
      GIT_COMMON_DIR: '/real/repo/.git',
      GIT_NAMESPACE: 'ns',
      GIT_PREFIX: 'sub/',
      GIT_QUARANTINE_PATH: '/q',
      GIT_SSH_COMMAND: 'ssh -i key',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'User',
    });

    // Repo-location vars (exported by git hooks) would redirect every spawned
    // git away from mindRoot — they must never survive.
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_COMMON_DIR',
      'GIT_NAMESPACE',
      'GIT_PREFIX',
      'GIT_QUARANTINE_PATH',
    ]) {
      expect(sanitized, `${key} must be removed`).not.toHaveProperty(key);
    }

    // Legitimate user-level git env stays.
    expect(sanitized.PATH).toBe('/usr/bin');
    expect(sanitized.HOME).toBe('/home/u');
    expect(sanitized.GIT_SSH_COMMAND).toBe('ssh -i key');
    expect(sanitized.GIT_TERMINAL_PROMPT).toBe('0');
    expect(sanitized.GIT_AUTHOR_NAME).toBe('User');
  });

  it('every git spawn in the sync handler uses a sanitized env', () => {
    const source = readFileSync(join(__dirname, 'server', 'handlers', 'sync.ts'), 'utf-8');
    // Count execFileSync('git', ...) option objects without an env key by
    // checking each call site mentions sanitizeGitEnv in its options.
    const calls = source.split(/execFileSync\('git',/).slice(1);
    expect(calls.length).toBeGreaterThan(0);
    for (const [index, call] of calls.entries()) {
      const options = call.slice(0, call.indexOf('})'));
      expect(options, `git spawn #${index + 1} must pass a sanitized env`).toContain('sanitizeGitEnv');
    }
  });
});
