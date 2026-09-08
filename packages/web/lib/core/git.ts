import { execFileSync } from 'child_process';
import { resolveExistingSafe } from './security';
import { sanitizedGitEnv } from '../git-env';
import type { GitLogEntry } from './types';

/**
 * Checks if the mindRoot directory is inside a git repository.
 */
export function isGitRepo(mindRoot: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: mindRoot, stdio: 'pipe', env: sanitizedGitEnv() });
    return true;
  } catch { return false; }
}

/**
 * Returns git log entries for a given file.
 */
export function gitLog(mindRoot: string, filePath: string, limit: number): GitLogEntry[] {
  const resolved = resolveExistingSafe(mindRoot, filePath);
  const output = execFileSync(
    'git',
    ['log', '--follow', '--format=%H%x00%aI%x00%s%x00%an', '-n', String(limit), '--', resolved],
    { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: sanitizedGitEnv() }
  ).trim();
  if (!output) return [];
  return output.split('\n').map(line => {
    const [hash, date, message, author] = line.split('\0');
    return { hash, date, message, author };
  });
}

/**
 * Returns the content of a file at a specific git commit.
 */
// Mirrors @geminilight/mindos knowledge/git: a leading `-` in <rev> would be
// parsed by `git show` as an option (e.g. `--output=/outside/root`).
const SAFE_GIT_COMMIT_REF = /^(?:[0-9a-fA-F]{4,64}|HEAD(?:[~^]\d*)*)$/;

export function isSafeGitCommitRef(value: string): boolean {
  return SAFE_GIT_COMMIT_REF.test(value.trim());
}

export function gitShowFile(mindRoot: string, filePath: string, commitHash: string): string {
  if (!isSafeGitCommitRef(commitHash)) {
    throw new Error(`Invalid git commit reference: ${commitHash}`);
  }
  const resolved = resolveExistingSafe(mindRoot, filePath);
  const relFromGitRoot = execFileSync(
    'git',
    ['ls-files', '--full-name', resolved],
    { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: sanitizedGitEnv() }
  ).trim();
  if (!relFromGitRoot) {
    return execFileSync(
      'git',
      ['show', `${commitHash}:${filePath}`],
      { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: sanitizedGitEnv() }
    );
  }
  return execFileSync(
    'git',
    ['show', `${commitHash}:${relFromGitRoot}`],
    { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: sanitizedGitEnv() }
  );
}
