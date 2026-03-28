import { execFileSync } from 'child_process';
import { resolveSafe } from './security';
import type { GitLogEntry } from './types';

/**
 * Checks if the mindRoot directory is inside a git repository.
 */
export function isGitRepo(mindRoot: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: mindRoot, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

/**
 * Returns git log entries for a given file.
 */
export function gitLog(mindRoot: string, filePath: string, limit: number): GitLogEntry[] {
  const resolved = resolveSafe(mindRoot, filePath);
  const output = execFileSync(
    'git',
    ['log', '--follow', '--format=%H%x00%aI%x00%s%x00%an', '-n', String(limit), '--', resolved],
    { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
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
export function gitShowFile(mindRoot: string, filePath: string, commitHash: string): string {
  const resolved = resolveSafe(mindRoot, filePath);
  const relFromGitRoot = execFileSync(
    'git',
    ['ls-files', '--full-name', resolved],
    { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  if (!relFromGitRoot) {
    return execFileSync(
      'git',
      ['show', `${commitHash}:${filePath}`],
      { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  }
  return execFileSync(
    'git',
    ['show', `${commitHash}:${relFromGitRoot}`],
    { cwd: mindRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}
