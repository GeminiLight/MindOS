import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'packages', 'mindos', 'bin', 'cli.js');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'mindos-cli-file-safe-path-'));
  tempRoots.push(root);
  return root;
}

function runFileCommand(mindRoot: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'file', ...args], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: mindRoot,
        MIND_ROOT: mindRoot,
        NODE_ENV: 'test',
      },
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('mindos file safe path handling', () => {
  it('rejects Windows absolute file paths on POSIX hosts', () => {
    const mindRoot = makeRoot();

    const result = runFileCommand(mindRoot, ['create', 'C:/Users/Ada/secret.md', '--content', 'secret']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(existsSync(path.join(mindRoot, 'C:', 'Users', 'Ada', 'secret.md'))).toBe(false);
  });

  it('treats backslash parent segments as traversal', () => {
    const mindRoot = makeRoot();

    const result = runFileCommand(mindRoot, ['create', '..\\secret.md', '--content', 'secret']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(existsSync(path.join(mindRoot, '..\\secret.md'))).toBe(false);
  });

  it('normalizes backslashes for safe paths inside the knowledge base', () => {
    const mindRoot = makeRoot();

    const result = runFileCommand(mindRoot, ['create', 'Projects\\note.md', '--content', 'hello']);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(mindRoot, 'Projects', 'note.md'), 'utf-8')).toBe('hello');
  });

  it('rejects writes through symlinked parents outside the knowledge base', () => {
    const mindRoot = makeRoot();
    const outside = makeRoot();
    symlinkSync(outside, path.join(mindRoot, 'Linked'), 'dir');

    const result = runFileCommand(mindRoot, ['create', 'Linked/secret.md', '--content', 'secret']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(existsSync(path.join(outside, 'secret.md'))).toBe(false);
  });

  it('rejects reads through symlinked files outside the knowledge base', () => {
    const mindRoot = makeRoot();
    const outside = makeRoot();
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'secret.md'), 'secret', 'utf-8');
    symlinkSync(path.join(outside, 'secret.md'), path.join(mindRoot, 'linked.md'), 'file');

    const result = runFileCommand(mindRoot, ['read', 'linked.md']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(result.stdout).not.toContain('secret');
  });
});
