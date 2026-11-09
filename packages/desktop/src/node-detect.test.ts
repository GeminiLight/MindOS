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

  it('never blocks the Electron main thread with a synchronous version probe', () => {
    const source = fs.readFileSync(path.join(__dirname, 'node-detect.ts'), 'utf-8');

    // execFileSync here froze the UI thread for up to 3s per candidate, and
    // getNodePath() probes up to eight candidates on a cold start.
    expect(source).not.toMatch(/execFileSync\s*\(/);
    expect(source).not.toMatch(/import\s*\{[^}]*execFileSync/);
    expect(source).toContain('async function checkNodeVersion(');
  });

  it('skips an incompatible private Node runtime during path detection', async () => {
    const privateNode = '/private/mindos/node';
    const versionChecks: string[] = [];
    const execFile = vi.fn((command: string, args: string[], _options: unknown, callback?: (...args: unknown[]) => void) => {
      const done = typeof _options === 'function' ? (_options as (...args: unknown[]) => void) : callback;
      if (args?.[0] === '--version') {
        versionChecks.push(command);
        if (command === privateNode) {
          done?.(null, { stdout: 'v22.16.0\n', stderr: '' });
          return;
        }
      }
      done?.(new Error('not found'), { stdout: '', stderr: '' });
    });
    vi.doMock('child_process', () => ({ execFile }));
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
    expect(versionChecks).toContain(privateNode);
  });
});
