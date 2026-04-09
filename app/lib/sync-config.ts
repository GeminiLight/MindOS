/**
 * Git sync configuration and state management.
 *
 * Extracted from sync/route.ts — provides config/state I/O and Git query helpers
 * that can be reused by CLI commands and other modules.
 */
import { execSync, execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MINDOS_DIR = join(homedir(), '.mindos');
export const CONFIG_PATH = join(MINDOS_DIR, 'config.json');
export const SYNC_STATE_PATH = join(MINDOS_DIR, 'sync-state.json');

// ---------------------------------------------------------------------------
// Config & state I/O
// ---------------------------------------------------------------------------

/** Atomic JSON write to prevent data corruption on crash/power loss. */
export function atomicWriteJSON(filePath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

export function loadConfig(): Record<string, any> {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

export function saveConfig(config: Record<string, unknown>): void {
  atomicWriteJSON(CONFIG_PATH, config);
}

export function loadSyncState(): Record<string, any> {
  try { return JSON.parse(readFileSync(SYNC_STATE_PATH, 'utf-8')); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Git queries
// ---------------------------------------------------------------------------

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

export function getRemoteUrl(cwd: string): string | null {
  try { return execSync('git remote get-url origin', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim(); } catch { return null; }
}

export function getBranch(cwd: string): string {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim(); } catch { return 'main'; }
}

export function getUnpushedCount(cwd: string): string {
  try { return execSync('git rev-list --count @{u}..HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim(); } catch { return '?'; }
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/** Validate that a file path is safely within mindRoot (prevents path traversal). */
export function isPathWithinMindRoot(mindRoot: string, filePath: string): boolean {
  const normalizedPath = resolve(mindRoot, filePath);
  return normalizedPath.startsWith(mindRoot + '/') || normalizedPath === mindRoot;
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

/** Resolve path to bin/cli.js — prefer env var set by CLI launcher, fall back to project root. */
function getCliPath(): string {
  return process.env.MINDOS_CLI_PATH || resolve(process.env.MINDOS_PROJECT_ROOT || process.cwd(), '..', 'bin', 'cli' + '.js');
}

/** Run CLI command via execFile — avoids shell injection by passing args as array. */
export function runCli(args: string[], timeoutMs = 30000): Promise<void> {
  const cliPath = getCliPath();
  const nodeBin = process.env.MINDOS_NODE_BIN || process.execPath;
  return new Promise((res, rej) => {
    execFile(nodeBin, [cliPath, ...args], { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) rej(new Error(stderr?.trim() || err.message));
      else res();
    });
  });
}
