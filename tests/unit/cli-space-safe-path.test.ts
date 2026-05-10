import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
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
  const root = mkdtempSync(path.join(tmpdir(), 'mindos-cli-space-safe-path-'));
  tempRoots.push(root);
  return root;
}

function runSpaceCommand(mindRoot: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'space', ...args], {
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

describe('mindos space safe path handling', () => {
  it('rejects Windows absolute space paths on POSIX hosts', () => {
    const mindRoot = makeRoot();

    const result = runSpaceCommand(mindRoot, ['mkdir', 'C:/Users/Ada/space']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(existsSync(path.join(mindRoot, 'C:', 'Users', 'Ada', 'space'))).toBe(false);
  });

  it('treats backslash parent segments as traversal for directory creation', () => {
    const mindRoot = makeRoot();

    const result = runSpaceCommand(mindRoot, ['mkdir', '..\\outside']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(existsSync(path.join(mindRoot, '..\\outside'))).toBe(false);
  });

  it('normalizes backslashes for safe space paths inside the knowledge base', () => {
    const mindRoot = makeRoot();

    const result = runSpaceCommand(mindRoot, ['mkdir', 'Projects\\Area']);

    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(mindRoot, 'Projects', 'Area'))).toBe(true);
  });

  it('rejects traversal in rename targets', () => {
    const mindRoot = makeRoot();
    runSpaceCommand(mindRoot, ['mkdir', 'Projects']);

    const result = runSpaceCommand(mindRoot, ['rename', 'Projects', '..\\outside']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(existsSync(path.join(mindRoot, 'Projects'))).toBe(true);
    expect(existsSync(path.join(mindRoot, '..\\outside'))).toBe(false);
  });

  it('rejects directory creation through symlinked parents outside the knowledge base', () => {
    const mindRoot = makeRoot();
    const outside = makeRoot();
    symlinkSync(outside, path.join(mindRoot, 'Linked'), 'dir');

    const result = runSpaceCommand(mindRoot, ['mkdir', 'Linked/Space']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Access denied');
    expect(existsSync(path.join(outside, 'Space'))).toBe(false);
  });
});
