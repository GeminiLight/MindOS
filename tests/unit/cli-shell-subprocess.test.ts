import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-shell-test-'));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CLI shell helpers', () => {
  it('formats manual recovery commands with quoted working directories', async () => {
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      ROOT: tempDir,
    }));

    const shell = await import('../../packages/mindos/bin/lib/shell.js') as {
      formatManualCdCommand: (cwd: string, command: string, platform?: NodeJS.Platform) => string;
    };

    expect(shell.formatManualCdCommand("/tmp/MindOS App/user's data", 'npm install', 'linux')).toBe(
      "cd '/tmp/MindOS App/user'\\''s data' && npm install",
    );
    expect(shell.formatManualCdCommand('C:\\Users\\Ada Lovelace\\MindOS', 'npm install', 'win32')).toBe(
      'cd /d "C:\\Users\\Ada Lovelace\\MindOS" && npm install',
    );
  });

  it('prints a copy-pasteable manual npm install fallback for paths with spaces', async () => {
    const cwd = path.join(tempDir, "MindOS App's deps");
    fs.mkdirSync(cwd, { recursive: true });

    const installError = Object.assign(new Error('install failed'), { status: 17 });
    const mockExecFileSync = vi.fn(() => {
      throw installError;
    });
    vi.doMock('node:child_process', () => ({
      execFileSync: mockExecFileSync,
    }));
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      ROOT: tempDir,
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit ${code}`);
    }) as never);

    const shell = await import('../../packages/mindos/bin/lib/shell.js') as {
      npmInstall: (cwd: string, extraFlags?: string[]) => void;
    };

    expect(() => shell.npmInstall(cwd, ['--no-workspaces'])).toThrow('exit 17');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Try manually: cd '${cwd.replace(/'/g, "'\\''")}' && npm install --no-workspaces`),
    );

    exitSpy.mockRestore();
  });

  it('uses argv-safe subprocess APIs instead of shell strings', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'lib', 'shell.js'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("import { execFileSync } from 'node:child_process'");
    expect(source).toContain('execFileSync(command, args');
  });

  it('runs inherited commands with an explicit argv array', async () => {
    const mockExecFileSync = vi.fn();
    vi.doMock('node:child_process', () => ({
      execFileSync: mockExecFileSync,
    }));
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      ROOT: tempDir,
    }));

    const shell = await import('../../packages/mindos/bin/lib/shell.js') as {
      execInheritedFile: (command: string, args: string[], cwd?: string, envPatch?: Record<string, string>) => void;
    };

    shell.execInheritedFile('node', ['scripts/setup.js', '--install-daemon'], tempDir, { MINDOS_TEST: '1' });

    expect(mockExecFileSync).toHaveBeenCalledWith('node', ['scripts/setup.js', '--install-daemon'], {
      cwd: tempDir,
      stdio: 'inherit',
      env: expect.objectContaining({ MINDOS_TEST: '1' }),
    });
  });

  it('runs npm install fallback without concatenating flags into a shell command', async () => {
    const mockExecFileSync = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('cache miss'), { status: 17 });
      })
      .mockReturnValueOnce(Buffer.from('ok'));
    vi.doMock('node:child_process', () => ({
      execFileSync: mockExecFileSync,
    }));
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      ROOT: tempDir,
    }));

    const shell = await import('../../packages/mindos/bin/lib/shell.js') as {
      npmInstall: (cwd: string, extraFlags?: string[]) => void;
    };

    shell.npmInstall(tempDir, ['--no-workspaces']);

    expect(mockExecFileSync).toHaveBeenNthCalledWith(1, 'npm', ['install', '--no-workspaces', '--prefer-offline'], {
      cwd: tempDir,
      stdio: 'inherit',
      env: process.env,
    });
    expect(mockExecFileSync).toHaveBeenNthCalledWith(2, 'npm', ['install', '--no-workspaces'], {
      cwd: tempDir,
      stdio: 'inherit',
      env: process.env,
    });
  });
});
