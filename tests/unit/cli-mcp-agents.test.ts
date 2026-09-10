import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { detectAgentPresence } from '../../packages/mindos/bin/lib/mcp-agents.js';

// `bin/lib/mcp-agents.js` is a mirror of the generated agent-config bundle; its
// loader (`bin/lib/agent-config.js`) checks the bundle/source/builder paths
// through `existsSync`. Those package-infrastructure probes must see the real
// filesystem (otherwise the loader thinks the bundle is missing and cannot
// rebuild), while every other probe — the agent presence dirs this suite is
// about — stays mocked to false.
const isPackageInfraPath = vi.hoisted(() => (p: unknown): boolean =>
  typeof p === 'string' && (p.includes('packages/mindos') || p.includes('build-cli-bundles')));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p) => (isPackageInfraPath(p) ? actual.existsSync(p) : false)) as unknown as typeof actual.existsSync,
  };
});

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
  execSync: vi.fn(() => {
    throw new Error('shell command lookup should not be used');
  }),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockExecFileSync = vi.mocked(execFileSync);
const mockExecSync = vi.mocked(execSync);
const originalPlatform = process.platform;

describe('CLI MCP agent detection', () => {
  beforeEach(async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    mockExistsSync.mockReset();
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockExistsSync.mockImplementation(((p: unknown) =>
      (isPackageInfraPath(p) ? actualFs.existsSync(p as string) : false)) as typeof existsSync);
    mockExecSync.mockImplementation(() => {
      throw new Error('shell command lookup should not be used');
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('checks CLI presence with execFileSync argv on Unix', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin/claude\n'));

    expect(detectAgentPresence('claude-code')).toBe(true);

    expect(mockExecFileSync).toHaveBeenCalledWith('which', ['claude'], { stdio: 'pipe' });
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('checks CLI presence with execFileSync argv on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockExecFileSync.mockReturnValue(Buffer.from('C:\\Tools\\claude.cmd\r\n'));

    expect(detectAgentPresence('claude-code')).toBe(true);

    expect(mockExecFileSync).toHaveBeenCalledWith('where', ['claude'], { stdio: 'pipe' });
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
