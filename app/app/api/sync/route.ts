export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
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

export async function GET() {
  const config = loadConfig();
  const syncConfig = config.sync || {};
  const state = loadSyncState();
  const mindRoot = config.mindRoot;

  if (!syncConfig.enabled) {
    return NextResponse.json({ enabled: false });
  }

  const remote = mindRoot && isGitRepo(mindRoot) ? getRemoteUrl(mindRoot) : null;
  const branch = mindRoot && isGitRepo(mindRoot) ? getBranch(mindRoot) : null;
  const unpushed = mindRoot && isGitRepo(mindRoot) ? getUnpushedCount(mindRoot) : '?';

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
    const body = await req.json() as { action: string };
    const config = loadConfig();
    const mindRoot = config.mindRoot;

    if (!mindRoot) {
      return NextResponse.json({ error: 'No mindRoot configured' }, { status: 400 });
    }

    switch (body.action) {
      case 'now': {
        if (!isGitRepo(mindRoot)) {
          return NextResponse.json({ error: 'Not a git repository' }, { status: 400 });
        }
        // Pull
        try { execSync('git pull --rebase --autostash', { cwd: mindRoot, stdio: 'pipe' }); } catch {
          try { execSync('git rebase --abort', { cwd: mindRoot, stdio: 'pipe' }); } catch {}
          try { execSync('git pull --no-rebase', { cwd: mindRoot, stdio: 'pipe' }); } catch {}
        }
        // Commit + push
        execSync('git add -A', { cwd: mindRoot, stdio: 'pipe' });
        const status = execSync('git status --porcelain', { cwd: mindRoot, encoding: 'utf-8' }).trim();
        if (status) {
          const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
          execSync(`git commit -m "auto-sync: ${timestamp}"`, { cwd: mindRoot, stdio: 'pipe' });
          execSync('git push', { cwd: mindRoot, stdio: 'pipe' });
        }
        const state = loadSyncState();
        state.lastSync = new Date().toISOString();
        writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
        return NextResponse.json({ ok: true });
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

      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
