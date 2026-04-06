export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { execSync, execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const MINDOS_DIR = join(homedir(), '.mindos');
const CONFIG_PATH = join(MINDOS_DIR, 'config.json');
const SYNC_STATE_PATH = join(MINDOS_DIR, 'sync-state.json');

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

/** Atomic write to prevent data corruption on crash/power loss */
function atomicWriteJSON(filePath: string, data: unknown) {
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

function saveConfig(config: Record<string, unknown>) {
  atomicWriteJSON(CONFIG_PATH, config);
}

/** Validate that a file path is safely within mindRoot (prevents path traversal) */
function isPathWithinMindRoot(mindRoot: string, filePath: string): boolean {
  const normalizedPath = resolve(mindRoot, filePath);
  // Must start with mindRoot + separator to prevent escape via symlinks or ../
  return normalizedPath.startsWith(mindRoot + '/') || normalizedPath === mindRoot;
}

function loadSyncState() {
  try { return JSON.parse(readFileSync(SYNC_STATE_PATH, 'utf-8')); } catch { return {}; }
}

function getRemoteUrl(cwd: string) {
  try { return execSync('git remote get-url origin', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim(); } catch { return null; }
}

function getBranch(cwd: string) {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim(); } catch { return 'main'; }
}

function getUnpushedCount(cwd: string) {
  try { return execSync('git rev-list --count @{u}..HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim(); } catch { return '?'; }
}

function isGitRepo(dir: string) {
  return existsSync(join(dir, '.git'));
}

/** Resolve path to bin/cli.js — prefer env var set by CLI launcher, fall back to project root. */
function getCliPath() {
  return process.env.MINDOS_CLI_PATH || resolve(process.env.MINDOS_PROJECT_ROOT || process.cwd(), '..', 'bin', 'cli' + '.js');
}

/** Run CLI command via execFile — avoids shell injection by passing args as array */
function runCli(args: string[], timeoutMs = 30000): Promise<void> {
  const cliPath = getCliPath();
  const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;
  return new Promise((res, rej) => {
    execFile(nodeBin, [cliPath, ...args], { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) rej(new Error(stderr?.trim() || err.message));
      else res();
    });
  });
}

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

        // Call CLI's sync init — pass clean remote + token separately (never embed token in URL)
        try {
          const args = ['sync', 'init', '--non-interactive', '--remote', remote, '--branch', branch];
          if (body.token) args.push('--token', body.token);
          await runCli(args, 120000); // git init + remote setup can take 60s+
          return NextResponse.json({ success: true, message: 'Sync initialized' });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: errMsg }, { status: 400 });
        }
      }

      case 'now': {
        if (!isGitRepo(mindRoot)) {
          return NextResponse.json({ error: 'Not a git repository' }, { status: 400 });
        }
        // Delegate to CLI for unified conflict handling
        try {
          await runCli(['sync', 'now'], 120000); // pull + push can take 60s+
          return NextResponse.json({ ok: true });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: errMsg }, { status: 500 });
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
        // Clear sync config so user can re-configure from scratch
        delete config.sync;
        saveConfig(config);
        // Clear sync state
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
        // Resolve a single conflict: keep-local (default) or keep-remote
        const file = body.remote; // reuse field: relative path of conflict file
        const strategy = body.branch ?? 'keep-local'; // reuse field
        if (!file || typeof file !== 'string') {
          return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
        }
        // Security: prevent path traversal attacks
        if (!isPathWithinMindRoot(mindRoot, file)) {
          return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
        }
        const conflictPath = resolve(mindRoot, file + '.sync-conflict');
        const originalPath = resolve(mindRoot, file);
        try {
          if (strategy === 'keep-remote' && existsSync(conflictPath)) {
            // Replace local with remote version
            const remoteContent = readFileSync(conflictPath, 'utf-8');
            writeFileSync(originalPath, remoteContent, 'utf-8');
          }
          // Clean up .sync-conflict file
          if (existsSync(conflictPath)) {
            unlinkSync(conflictPath);
          }
          // Remove this conflict from sync state
          const state = loadSyncState();
          if (state.conflicts) {
            state.conflicts = state.conflicts.filter((c: { file: string }) => c.file !== file);
            atomicWriteJSON(SYNC_STATE_PATH, state);
          }
          return NextResponse.json({ ok: true });
        } catch (e) {
          return NextResponse.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      case 'conflict-preview': {
        const file = body.remote;
        if (!file || typeof file !== 'string') {
          return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
        }
        // Security: prevent path traversal attacks
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
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
