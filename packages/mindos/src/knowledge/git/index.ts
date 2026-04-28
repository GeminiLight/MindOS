import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Result } from '../../foundation/shared/index.js';
import { createError } from '../../foundation/errors/index.js';
import { resolveSafeResult } from '../../foundation/security/index.js';

const execFileAsync = promisify(execFile);

// Helper functions for Result type
function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: Error): Result<T> {
  return { ok: false, error };
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

/**
 * Checks if the mindRoot directory is inside a git repository.
 */
export async function isGitRepo(mindRoot: string): Promise<Result<boolean>> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: mindRoot,
      encoding: 'utf-8',
    });
    return ok(true);
  } catch {
    return ok(false);
  }
}

/**
 * Returns git log entries for a given file.
 */
export async function gitLog(
  mindRoot: string,
  filePath: string,
  limit: number
): Promise<Result<GitLogEntry[]>> {
  const resolveResult = resolveSafeResult(mindRoot, filePath);
  if (!resolveResult.ok) {
    return err(resolveResult.error);
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--follow', '--format=%H%x00%aI%x00%s%x00%an', '-n', String(limit), '--', resolveResult.value],
      { cwd: mindRoot, encoding: 'utf-8' }
    );

    const output = stdout.trim();
    if (!output) return ok([]);

    const entries = output.split('\n').map(line => {
      const [hash, date, message, author] = line.split('\0');
      return { hash: hash || '', date: date || '', message: message || '', author: author || '' };
    });

    return ok(entries);
  } catch (error) {
    return err(
      createError('INTERNAL_ERROR', 'Failed to get git log', {
        context: { filePath, error: error instanceof Error ? error.message : String(error) },
      })
    );
  }
}

/**
 * Returns the content of a file at a specific git commit.
 */
export async function gitShowFile(
  mindRoot: string,
  filePath: string,
  commitHash: string
): Promise<Result<string>> {
  const resolveResult = resolveSafeResult(mindRoot, filePath);
  if (!resolveResult.ok) {
    return err(resolveResult.error);
  }

  try {
    // First try to get the git-relative path
    let relFromGitRoot = '';
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '--full-name', resolveResult.value],
        { cwd: mindRoot, encoding: 'utf-8' }
      );
      relFromGitRoot = stdout.trim();
    } catch {
      // If ls-files fails, we'll try with the original path
    }

    const pathToUse = relFromGitRoot || filePath;
    const { stdout } = await execFileAsync(
      'git',
      ['show', `${commitHash}:${pathToUse}`],
      { cwd: mindRoot, encoding: 'utf-8' }
    );

    return ok(stdout);
  } catch (error) {
    return err(
      createError('INTERNAL_ERROR', 'Failed to show git file', {
        context: {
          filePath,
          commitHash,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    );
  }
}
