import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  it('escapes Windows batch metacharacters in generated set values', async () => {
    vi.doMock('node:os', () => ({
      homedir: () => tempDir,
      platform: () => 'win32',
    }));
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      CLI_PATH: 'C:\\MindOS%TEMP%^A!B\\bin\\cli.js',
    }));

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
});
