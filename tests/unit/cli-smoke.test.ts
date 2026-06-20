import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * CLI smoke tests — verify core commands don't crash on invocation.
 * Runs `node packages/mindos/bin/cli.js` in a subprocess with HOME set to an empty temp dir
 * so no real config interferes.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'packages', 'mindos', 'bin', 'cli.js');
const SHIM = path.join(ROOT, 'packages', 'mindos', 'bin', 'mindos-shim.cjs');

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

function runShim(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [SHIM, ...args], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: tempHome,
        NODE_ENV: 'test',
        MINDOS_DISABLE_PLATFORM_PACKAGE_LOOKUP: '1',
        MINDOS_DISABLE_RUNTIME_DOWNLOAD: '1',
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

function writeConfig(config: Record<string, unknown>) {
  const dir = path.join(tempHome, '.mindos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
}

function makeMindRoot() {
  const mindRoot = path.join(tempHome, 'mind');
  fs.mkdirSync(mindRoot, { recursive: true });
  return mindRoot;
}

function writeDefaultConfig(overrides: Record<string, unknown> = {}) {
  const mindRoot = makeMindRoot();
  writeConfig({
    mindRoot,
    port: 9,
    mcpPort: 8781,
    ai: { activeProvider: 'skip', providers: [] },
    ...overrides,
  });
  return mindRoot;
}

describe('CLI smoke tests', () => {
  it('mindos --version exits 0 and outputs version', () => {
    const { stdout, exitCode } = run(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/mindos\/\d+\.\d+\.\d+/);
  });

  it('mindos shim handles global help/version without runtime resolution', () => {
    const version = runShim(['--version']);
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toMatch(/mindos\/\d+\.\d+\.\d+/);

    const help = runShim(['--help']);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('MindOS CLI');
    expect(help.stdout).toContain('agent');
    expect(help.stdout).not.toMatch(/\n\s+ask\s+/);
  });

  it('mindos --help exits 0 and outputs help text', () => {
    const { stdout, exitCode } = run(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('MindOS CLI');
    expect(stdout).not.toMatch(/\n\s+ask\s+/);
  });

  it('mindos doctor without config exits 1 and suggests onboard', () => {
    const { stdout, stderr, exitCode } = run(['doctor']);
    expect(exitCode).toBe(1);
    const output = stdout + stderr;
    expect(output).toMatch(/onboard/i);
  });

  it('mindos doctor uses argv-safe subprocess probes', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'commands', 'doctor.js'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("execFileSync('npm', ['--version']");
    expect(source).toContain("execFileSync('systemctl', ['--user', 'is-active', 'mindos']");
    expect(source).toContain("execFileSync('id', ['-u']");
    expect(source).toContain("execFileSync('launchctl', ['print', `gui/${uid}/com.mindos.app`]");
  });

  it('mindos doctor uses Windows PATH registry wording after shim injection', async () => {
    const doctor = await import('../../packages/mindos/bin/commands/doctor.js') as {
      formatShimActivationWarning: (platform: NodeJS.Platform) => string;
    };

    expect(doctor.formatShimActivationWarning('win32')).toContain('user PATH');
    expect(doctor.formatShimActivationWarning('win32')).not.toContain('shell rc');
    expect(doctor.formatShimActivationWarning('darwin')).toContain('shell rc files');
  });

  it('mindos doctor checks the platform-specific shim executable', async () => {
    const doctor = await import('../../packages/mindos/bin/commands/doctor.js') as {
      getShimExecutablePath: (platform: NodeJS.Platform, homeDir: string) => string;
    };

    expect(doctor.getShimExecutablePath('win32', 'C:\\Users\\Ada')).toMatch(/mindos\.cmd$/);
    expect(doctor.getShimExecutablePath('darwin', '/Users/ada')).toMatch(/\/mindos$/);
  });

  it('mindos config show without config exits 1', () => {
    const { exitCode } = run(['config', 'show']);
    expect(exitCode).toBe(1);
  });

  it('mindos config validate without config exits 1', () => {
    const { exitCode } = run(['config', 'validate']);
    expect(exitCode).toBe(1);
  });

  it('mindos config show masks provider-array secrets', () => {
    writeDefaultConfig({
      authToken: 'auth-token-secret',
      ai: {
        activeProvider: 'p_openai01',
        providers: [
          {
            id: 'p_openai01',
            protocol: 'openai',
            apiKey: 'sk-test-1234567890',
            model: 'gpt-test',
            baseUrl: 'https://example.invalid/v1',
          },
        ],
      },
    });

    const { stdout, exitCode } = run(['config', 'show', '--json']);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('sk-test-1234567890');
    expect(stdout).not.toContain('auth-token-secret');
    const config = JSON.parse(stdout);
    expect(config.ai.providers[0].apiKey).toBe('sk-tes****');
    expect(config.authToken).toBe('auth-t****');
  });

  it('mindos config validate accepts provider-array configs', () => {
    writeDefaultConfig({
      ai: {
        activeProvider: 'p_openai01',
        providers: [
          {
            id: 'p_openai01',
            protocol: 'openai',
            apiKey: 'sk-test-1234567890',
            model: 'gpt-test',
            baseUrl: 'https://example.invalid/v1',
          },
        ],
      },
    });

    const { stdout, exitCode } = run(['config', 'validate']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Config is valid');
  });

  it('mindos doctor recognizes provider-array configs', () => {
    writeDefaultConfig({
      ai: {
        activeProvider: 'p_openai01',
        providers: [
          {
            id: 'p_openai01',
            protocol: 'openai',
            apiKey: 'sk-test-1234567890',
            model: 'gpt-test',
            baseUrl: 'https://example.invalid/v1',
          },
        ],
      },
    });

    const { stdout, exitCode } = run(['doctor', '--json']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('AI provider configured');
    expect(stdout).not.toContain('AI provider not configured');
  });

  it('mindos agent -p and deprecated ask -p keep the prompt text positional', () => {
    writeDefaultConfig();

    const agent = run(['agent', '-p', 'hello world', '--port=9']);
    expect(agent.exitCode).toBe(3);
    expect(agent.stderr).toContain('MindOS is not running');
    expect(agent.stderr).not.toContain('No task provided');

    const ask = run(['ask', '-p', 'hello world', '--port=9']);
    expect(ask.exitCode).toBe(3);
    expect(ask.stderr).toContain('mindos ask has been replaced by mindos agent');
    expect(ask.stderr).toContain('MindOS is not running');
    expect(ask.stderr).not.toContain('No question provided');
  });

  it('bare mindos enters the agent instead of showing global help', () => {
    writeDefaultConfig();

    const result = run(['--port=9']);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('MindOS is not running');
    expect(result.stdout).not.toContain('COMMANDS');
  });

  it('mindos -p routes a top-level task to the agent', () => {
    writeDefaultConfig();

    const result = run(['-p', 'hello world', '--port=9']);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('MindOS is not running');
    expect(result.stderr).not.toContain('No task provided');
  });

  it('mindos file list is paginated by default and supports --all', () => {
    const mindRoot = writeDefaultConfig();
    fs.writeFileSync(path.join(mindRoot, 'a.md'), 'a');
    fs.writeFileSync(path.join(mindRoot, 'b.md'), 'b');
    fs.writeFileSync(path.join(mindRoot, 'c.md'), 'c');

    const paged = run(['file', 'list', '--json', '--limit=2']);
    expect(paged.exitCode).toBe(0);
    const page = JSON.parse(paged.stdout);
    expect(page).toMatchObject({
      count: 3,
      returned: 2,
      offset: 0,
      limit: 2,
      hasMore: true,
      nextOffset: 2,
    });
    expect(page.files).toHaveLength(2);

    const all = run(['file', 'list', '--json', '--all']);
    expect(all.exitCode).toBe(0);
    expect(JSON.parse(all.stdout)).toMatchObject({
      count: 3,
      returned: 3,
      limit: null,
      hasMore: false,
    });
  });

  it('mindos sync without config exits 0 and shows not configured', () => {
    const { stdout, exitCode } = run(['sync']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/not configured/i);
  });

  it('unknown top-level text is treated as an agent task', () => {
    writeDefaultConfig();

    const { stderr, exitCode } = run(['nonexistent', '--port=9']);
    expect(exitCode).toBe(3);
    expect(stderr).toContain('MindOS is not running');
  });
});
