/**
 * Behavior contract for the lazy CLI runtime: fast paths (--version, single
 * command) must not import every command module, while help and aliases keep
 * their original behavior. Unknown top-level text now routes to the default
 * agent entrypoint.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const RUNTIME_SOURCE = readFileSync(path.resolve(__dirname, 'cli-runtime.js'), 'utf-8');

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { encoding: 'utf-8', timeout: 20000, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        const anyErr = err as (Error & { code?: number }) | null;
        const code = anyErr ? (typeof anyErr.code === 'number' ? anyErr.code : 1) : 0;
        resolvePromise({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });
}

function createTempHomeWithConfig(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'mindos-runtime-cli-'));
  const mindRoot = path.join(home, 'mind');
  mkdirSync(path.join(home, '.mindos'), { recursive: true });
  mkdirSync(mindRoot, { recursive: true });
  writeFileSync(path.join(home, '.mindos', 'config.json'), JSON.stringify({
    mindRoot,
    port: 9,
    mcpPort: 8781,
    ai: { activeProvider: 'skip', providers: [] },
  }, null, 2), 'utf-8');
  return home;
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
    expect(stdout).not.toMatch(/\n\s+ask\s+/);
    expect(stdout).toContain('mindos [task] [flags]');
    expect(stdout).toContain('mindos <command> [flags]');
  });

  it('keeps ask as a deprecated compatibility alias for agent', async () => {
    const { stdout, stderr, code } = await runCli(['ask', '--help']);
    expect(code).toBe(0);
    expect(stderr).toContain('mindos ask has been replaced by mindos agent');
    expect(stdout).toContain('mindos agent');
    expect(stdout).not.toContain('Chat mode');
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

  it('routes unknown top-level text to the default agent entrypoint', async () => {
    const home = createTempHomeWithConfig();
    try {
      const { stdout, stderr, code } = await runCli(
        ['definitely-not-a-command', '--port=9'],
        { HOME: home, NODE_ENV: 'test' },
      );
      expect(code).toBe(3);
      expect(stdout).not.toContain('COMMANDS');
      expect(stderr).toContain('MindOS is not running');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
