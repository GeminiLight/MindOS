import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('node-detect command execution', () => {
  afterEach(() => {
    vi.doUnmock('child_process');
    vi.doUnmock('./node-bootstrap');
    vi.doUnmock('./app-config-store');
    vi.doUnmock('./desktop-home');
    vi.doUnmock('./exec-target');
    vi.resetModules();
  });

  it('does not interpolate discovered executable paths into shell command strings', () => {
    const source = fs.readFileSync(path.join(__dirname, 'node-detect.ts'), 'utf-8');

    expect(source).not.toContain("import { exec,");
    expect(source).not.toContain('promisify(exec)');
    expect(source).not.toContain('`"${npmBin}" root -g`');
    expect(source).not.toContain("'npm root -g'");
    expect(source).not.toContain('`${sh} -il -c "which node"');
  });

  it('skips an incompatible private Node runtime during path detection', async () => {
    const privateNode = '/private/mindos/node';
    const execFileSync = vi.fn((command: string) => {
      if (command === privateNode) return 'v22.16.0\n';
      throw new Error(`unexpected version check: ${command}`);
    });
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(new Error('not found'), '', '');
    });
    vi.doMock('child_process', () => ({ execFile, execFileSync }));
    vi.doMock('./node-bootstrap', () => ({
      getBundledNodePath: () => '/bundled/node',
      getPrivateNodePath: () => privateNode,
      isBundledNodeInstalled: () => false,
      isPrivateNodeInstalled: () => true,
    }));
    vi.doMock('./app-config-store', () => ({
      getAppConfigStore: () => ({ get: () => undefined, set: vi.fn() }),
    }));
    vi.doMock('./desktop-home', () => ({ getDesktopHome: () => '/definitely/missing-home' }));
    vi.doMock('./exec-target', () => ({
      resolveExecTarget: (command: string, args: string[]) => ({ command, args }),
    }));

    const { getNodePath } = await import('./node-detect');

    expect(await getNodePath()).not.toBe(privateNode);
    expect(execFileSync).toHaveBeenCalledWith(
      privateNode,
      ['--version'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });
});
