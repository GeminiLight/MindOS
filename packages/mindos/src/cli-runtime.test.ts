/**
 * Behavior contract for the lazy CLI runtime: fast paths (--version, single
 * command) must not import every command module, while help, aliases, and
 * unknown-command handling keep their original behavior.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const RUNTIME_SOURCE = readFileSync(path.resolve(__dirname, 'cli-runtime.js'), 'utf-8');

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { encoding: 'utf-8', timeout: 20000 },
      (err, stdout, stderr) => {
        const anyErr = err as (Error & { code?: number }) | null;
        const code = anyErr ? (typeof anyErr.code === 'number' ? anyErr.code : 1) : 0;
        resolvePromise({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });
}

describe('cli-runtime lazy command loading', () => {
  it('keeps no eager top-level imports of command modules', () => {
    expect(RUNTIME_SOURCE).not.toMatch(/^import \* as \w+ from '\.\.\/bin\/commands\//m);
    // every command module is referenced through a dynamic import loader
    expect(RUNTIME_SOURCE).toContain("import('../bin/commands/start.js')");
  });

  it('prints version and exits 0 on --version', async () => {
    const { stdout, code } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^mindos\/\d+\.\d+\.\d+ node\/v/);
  });

  it('shows global help listing core commands on --help', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('COMMANDS');
    expect(stdout).toContain('mcp');
    expect(stdout).toContain('agent');
    expect(stdout).toContain('mindos <command> [flags]');
  });

  it('shows command help for an invoked command (mcp --help)', async () => {
    const { stdout, code } = await runCli(['mcp', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('USAGE');
    expect(stdout).toContain('mindos mcp');
  });

  it('resolves the serve display alias to the start command', async () => {
    const { stdout, code } = await runCli(['serve', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Start MindOS services');
  });

  it('resolves meta-only aliases through the registry fallback (setup → onboard)', async () => {
    const { stdout, code } = await runCli(['setup', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('First-time setup wizard');
  });

  it('exits 1 with global help for an unknown command', async () => {
    const { stdout, code } = await runCli(['definitely-not-a-command']);
    expect(code).toBe(1);
    expect(stdout).toContain('COMMANDS');
  });
});
