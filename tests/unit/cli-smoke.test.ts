import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * CLI smoke tests — verify core commands don't crash on invocation.
 * Runs `node bin/cli.js` in a subprocess with HOME set to an empty temp dir
 * so no real config interferes.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

let tempHome: string;
let savedHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-smoke-'));
  savedHome = process.env.HOME;
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tempHome, NODE_ENV: 'test' },
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

describe('CLI smoke tests', () => {
  it('mindos --version exits 0 and outputs version', () => {
    const { stdout, exitCode } = run(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/mindos\/\d+\.\d+\.\d+/);
  });

  it('mindos --help exits 0 and outputs help text', () => {
    const { stdout, exitCode } = run(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('MindOS CLI');
  });

  it('mindos doctor without config exits 1 and suggests onboard', () => {
    const { stdout, stderr, exitCode } = run(['doctor']);
    expect(exitCode).toBe(1);
    const output = stdout + stderr;
    expect(output).toMatch(/onboard/i);
  });

  it('mindos config show without config exits 1', () => {
    const { exitCode } = run(['config', 'show']);
    expect(exitCode).toBe(1);
  });

  it('mindos config validate without config exits 1', () => {
    const { exitCode } = run(['config', 'validate']);
    expect(exitCode).toBe(1);
  });

  it('mindos sync without config exits 0 and shows not configured', () => {
    const { stdout, exitCode } = run(['sync']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/not configured/i);
  });

  it('mindos nonexistent exits 1', () => {
    const { exitCode } = run(['nonexistent']);
    expect(exitCode).toBe(1);
  });
});
