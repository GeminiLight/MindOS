import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-cli-shim-test-'));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CLI shim generation', () => {
  function mockWindowsCliShim(cliPath = 'C:\\MindOS\\bin\\cli.js') {
    vi.doMock('node:os', () => ({
      homedir: () => tempDir,
      platform: () => 'win32',
    }));
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      CLI_PATH: cliPath,
    }));
  }

  it('escapes Windows batch metacharacters in generated set values', async () => {
    mockWindowsCliShim('C:\\MindOS%TEMP%^A!B\\bin\\cli.js');

    const shim = await import('../../packages/mindos/bin/lib/cli-shim.js') as {
      escapeCmdSetValue: (value: string) => string;
      ensureCliShim: () => boolean;
    };

    expect(shim.escapeCmdSetValue('C:\\MindOS%TEMP%^A!B\\bin\\cli.js')).toBe(
      'C:\\MindOS%%TEMP%%^^A^^!B\\bin\\cli.js',
    );

    shim.ensureCliShim();

    const cmd = fs.readFileSync(path.join(tempDir, '.mindos', 'bin', 'mindos.cmd'), 'utf-8');
    expect(cmd).toContain('set "CLI=C:\\MindOS%%TEMP%%^^A^^!B\\bin\\cli.js"');
  });

  it('falls back to a compatible PATH node when the private runtime is stale', async () => {
    vi.doMock('node:os', () => ({
      homedir: () => tempDir,
      platform: () => 'linux',
    }));
    const cli = path.join(tempDir, 'cli.js');
    const pathBin = path.join(tempDir, 'path-bin');
    const privateBin = path.join(tempDir, '.mindos', 'node', 'bin');
    fs.mkdirSync(pathBin, { recursive: true });
    fs.mkdirSync(privateBin, { recursive: true });
    fs.writeFileSync(cli, '// test cli');
    fs.writeFileSync(path.join(privateBin, 'node'), '#!/bin/sh\nif [ "$1" = "-e" ]; then exit 1; fi\necho private\n', { mode: 0o755 });
    fs.writeFileSync(path.join(pathBin, 'node'), '#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\necho path\n', { mode: 0o755 });
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({ CLI_PATH: cli }));

    const shim = await import('../../packages/mindos/bin/lib/cli-shim.js') as { ensureCliShim: () => boolean };
    shim.ensureCliShim();

    const result = spawnSync('sh', [path.join(tempDir, '.mindos', 'bin', 'mindos')], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tempDir, PATH: `${pathBin}:/usr/bin:/bin` },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('path');
  });

  it('adds the Windows shim directory to the user PATH registry, not only a PowerShell profile', async () => {
    mockWindowsCliShim();

    const mockExecFileSync = vi.fn((command: string, args: string[]) => {
      expect(command).toBe('powershell.exe');
      if (args.some((arg) => arg.includes('GetEnvironmentVariable'))) {
        return 'C:\\Windows\\System32';
      }
      return '';
    });
    vi.doMock('node:child_process', () => ({
      execFileSync: mockExecFileSync,
    }));

    const shim = await import('../../packages/mindos/bin/lib/cli-shim.js') as {
      ensureCliShim: () => boolean;
    };

    expect(shim.ensureCliShim()).toBe(true);

    expect(mockExecFileSync).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile',
      '-Command',
      '[Environment]::GetEnvironmentVariable("Path", "User")',
    ], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile',
      '-Command',
      expect.stringContaining("[Environment]::SetEnvironmentVariable('Path', '"),
    ], expect.any(Object));
  });

  it('detects the Windows shim directory in PATH case-insensitively', async () => {
    mockWindowsCliShim();
    const shimDir = path.resolve(tempDir, '.mindos', 'bin');
    const originalPath = process.env.PATH;
    process.env.PATH = `${shimDir.toUpperCase()};C:\\Tools`;

    try {
      const shim = await import('../../packages/mindos/bin/lib/cli-shim.js') as {
        isShimInPath: () => boolean;
      };

      expect(shim.isShimInPath()).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
