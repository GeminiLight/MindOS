export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { execSync, execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const MINDOS_DIR = join(homedir(), '.mindos');
const CONFIG_PATH = join(MINDOS_DIR, 'config.json');
const SYNC_STATE_PATH = join(MINDOS_DIR, 'sync-state.json');

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

function saveConfig(config: Record<string, unknown>) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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
    const body = await req.json() as { action: string; remote?: string; branch?: string; token?: string; content?: string };
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

        // Check if sync is already configured
        if (config.sync?.enabled && isGitRepo(mindRoot) && getRemoteUrl(mindRoot)) {
          return NextResponse.json({ error: 'Sync already configured' }, { status: 400 });
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
        try { writeFileSync(SYNC_STATE_PATH, '{}', 'utf-8'); } catch {}
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
        const conflictPath = join(mindRoot, file + '.sync-conflict');
        const originalPath = join(mindRoot, file);
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
            writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
          }
          return NextResponse.json({ ok: true });
        } catch (e) {
          return NextResponse.json({ error: (e as Error).message }, { status: 500 });
        }
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
