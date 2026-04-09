export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { handleRouteErrorSimple } from '@/lib/errors';
import {
  CONFIG_PATH,
  SYNC_STATE_PATH,
  atomicWriteJSON,
  loadConfig,
  saveConfig,
  loadSyncState,
  isGitRepo,
  getRemoteUrl,
  getBranch,
  getUnpushedCount,
  isPathWithinMindRoot,
  runCli,
} from '@/lib/sync-config';

export async function GET() {
  const config = loadConfig();
  const syncConfig = config.sync || {};
  const state = loadSyncState();
  const mindRoot = config.mindRoot;

  if (!syncConfig.enabled) {
    return NextResponse.json({ enabled: false });
  }

  // Detect broken state: config says enabled but no git repo or no remote
  const hasRepo = mindRoot && isGitRepo(mindRoot);
  const remote = hasRepo ? getRemoteUrl(mindRoot) : null;
  if (!hasRepo || !remote) {
    return NextResponse.json({
      enabled: true,
      needsSetup: true,
      provider: syncConfig.provider || 'git',
      remote: remote || '(not configured)',
      branch: 'main',
      lastSync: null,
      lastPull: null,
      unpushed: '?',
      conflicts: [],
      lastError: !hasRepo
        ? 'Git repository not found in knowledge base directory. Please re-configure sync.'
        : 'Remote not configured. Please re-configure sync.',
      autoCommitInterval: syncConfig.autoCommitInterval || 30,
      autoPullInterval: syncConfig.autoPullInterval || 300,
    });
  }

  const branch = getBranch(mindRoot);
  const unpushed = getUnpushedCount(mindRoot);

  return NextResponse.json({
    enabled: true,
    provider: syncConfig.provider || 'git',
    remote: remote || '(not configured)',
    branch: branch || 'main',
    lastSync: state.lastSync || null,
    lastPull: state.lastPull || null,
    unpushed,
    conflicts: state.conflicts || [],
    lastError: state.lastError || null,
    autoCommitInterval: syncConfig.autoCommitInterval || 30,
    autoPullInterval: syncConfig.autoPullInterval || 300,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: string; remote?: string; branch?: string; token?: string; content?: string; autoCommitInterval?: number; autoPullInterval?: number };
    const config = loadConfig();
    const mindRoot = config.mindRoot;

    if (!mindRoot) {
      return NextResponse.json({ error: 'No mindRoot configured' }, { status: 400 });
    }

    switch (body.action) {
      case 'init': {
        const remote = body.remote?.trim();
        if (!remote) {
          return NextResponse.json({ error: 'Remote URL is required' }, { status: 400 });
        }

        // Validate URL format
        const isHTTPS = remote.startsWith('https://');
        const isSSH = /^git@[\w.-]+:.+/.test(remote);
        if (!isHTTPS && !isSSH) {
          return NextResponse.json({ error: 'Invalid remote URL — must be HTTPS or SSH format' }, { status: 400 });
        }

        const branch = body.branch?.trim() || 'main';

        try {
          const args = ['sync', 'init', '--non-interactive', '--remote', remote, '--branch', branch];
          if (body.token) args.push('--token', body.token);
          await runCli(args, 120000);
          return NextResponse.json({ success: true, message: 'Sync initialized' });
        } catch (err: unknown) {
          return handleRouteErrorSimple(err, 400);
        }
      }

      case 'now': {
        if (!isGitRepo(mindRoot)) {
          return NextResponse.json({ error: 'Not a git repository' }, { status: 400 });
        }
        try {
          await runCli(['sync', 'now'], 120000);
          return NextResponse.json({ ok: true });
        } catch (err: unknown) {
          return handleRouteErrorSimple(err);
        }
      }

      case 'on': {
        if (!config.sync) config.sync = {};
        config.sync.enabled = true;
        saveConfig(config);
        return NextResponse.json({ ok: true, enabled: true });
      }

      case 'off': {
        if (!config.sync) config.sync = {};
        config.sync.enabled = false;
        saveConfig(config);
        return NextResponse.json({ ok: true, enabled: false });
      }

      case 'reset': {
        delete config.sync;
        saveConfig(config);
        try { atomicWriteJSON(SYNC_STATE_PATH, {}); } catch {}
        return NextResponse.json({ ok: true, enabled: false });
      }

      case 'gitignore-get': {
        const gitignorePath = join(mindRoot, '.gitignore');
        try {
          const content = readFileSync(gitignorePath, 'utf-8');
          return NextResponse.json({ content });
        } catch {
          return NextResponse.json({ content: '' });
        }
      }

      case 'gitignore-save': {
        if (typeof body.content !== 'string') {
          return NextResponse.json({ error: 'Missing content' }, { status: 400 });
        }
        const gitignoreSavePath = join(mindRoot, '.gitignore');
        writeFileSync(gitignoreSavePath, body.content, 'utf-8');
        return NextResponse.json({ ok: true });
      }

      case 'resolve-conflict': {
        const file = body.remote;
        const strategy = body.branch ?? 'keep-local';
        if (!file || typeof file !== 'string') {
          return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
        }
        if (!isPathWithinMindRoot(mindRoot, file)) {
          return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
        }
        const conflictPath = resolve(mindRoot, file + '.sync-conflict');
        const originalPath = resolve(mindRoot, file);
        try {
          if (strategy === 'keep-remote' && existsSync(conflictPath)) {
            const remoteContent = readFileSync(conflictPath, 'utf-8');
            writeFileSync(originalPath, remoteContent, 'utf-8');
          }
          if (existsSync(conflictPath)) {
            unlinkSync(conflictPath);
          }
          const state = loadSyncState();
          if (state.conflicts) {
            state.conflicts = state.conflicts.filter((c: { file: string }) => c.file !== file);
            atomicWriteJSON(SYNC_STATE_PATH, state);
          }
          return NextResponse.json({ ok: true });
        } catch (e) {
          return handleRouteErrorSimple(e);
        }
      }

      case 'conflict-preview': {
        const file = body.remote;
        if (!file || typeof file !== 'string') {
          return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
        }
        if (!isPathWithinMindRoot(mindRoot, file)) {
          return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
        }
        const localPath = resolve(mindRoot, file);
        const remotePath = resolve(mindRoot, file + '.sync-conflict');
        const local = existsSync(localPath) ? readFileSync(localPath, 'utf-8') : '';
        const remote = existsSync(remotePath) ? readFileSync(remotePath, 'utf-8') : '';
        return NextResponse.json({ local, remote });
      }

      case 'update-intervals': {
        const commitInterval = typeof body.autoCommitInterval === 'number' ? body.autoCommitInterval : undefined;
        const pullInterval = typeof body.autoPullInterval === 'number' ? body.autoPullInterval : undefined;
        if (commitInterval === undefined && pullInterval === undefined) {
          return NextResponse.json({ error: 'At least one interval must be provided' }, { status: 400 });
        }
        if (commitInterval !== undefined && (!Number.isInteger(commitInterval) || commitInterval < 10 || commitInterval > 300)) {
          return NextResponse.json({ error: 'autoCommitInterval must be an integer between 10 and 300 seconds' }, { status: 400 });
        }
        if (pullInterval !== undefined && (!Number.isInteger(pullInterval) || pullInterval < 60 || pullInterval > 3600)) {
          return NextResponse.json({ error: 'autoPullInterval must be an integer between 60 and 3600 seconds' }, { status: 400 });
        }
        const fullConfig = loadConfig();
        if (!fullConfig.sync) fullConfig.sync = {};
        if (commitInterval !== undefined) fullConfig.sync.autoCommitInterval = commitInterval;
        if (pullInterval !== undefined) fullConfig.sync.autoPullInterval = pullInterval;
        atomicWriteJSON(CONFIG_PATH, fullConfig);
        return NextResponse.json({
          autoCommitInterval: fullConfig.sync.autoCommitInterval || 30,
          autoPullInterval: fullConfig.sync.autoPullInterval || 300,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    return handleRouteErrorSimple(err);
  }
}
