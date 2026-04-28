import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import { spawnAcpAgent } from '../../lib/acp/subprocess';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);
const mockExecFileSync = vi.mocked(execFileSync);

function makeChildProcess() {
  return {
    pid: 4321,
    stdin: {},
    stdout: {},
    stderr: { on: vi.fn() },
    on: vi.fn(),
  } as any;
}

describe('spawnAcpAgent', () => {
  const originalPlatform = process.platform;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue(makeChildProcess());
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env.SHELL = originalShell;
  });

  it('spawns with the absolute executable resolved from the login shell on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.SHELL = '/bin/zsh';

    mockExecFileSync.mockImplementation((command, args) => {
      if (command === 'which') throw new Error('not found');
      if (command === '/bin/zsh' && Array.isArray(args) && String(args[1]).includes("command -v -- 'gemini'")) {
        return '/Users/test/bin/gemini\n' as any;
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });

    spawnAcpAgent({ id: 'gemini' } as any);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/Users/test/bin/gemini',
      ['--experimental-acp'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('spawns Claude via the resolved npx executable instead of a bare command', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.SHELL = '/bin/zsh';

    mockExecFileSync.mockImplementation((command, args) => {
      if (command === 'which') throw new Error('not found');
      if (command === '/bin/zsh' && Array.isArray(args) && String(args[1]).includes("command -v -- 'npx'")) {
        return '/Users/test/bin/npx\n' as any;
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });

    spawnAcpAgent({ id: 'claude' } as any);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/Users/test/bin/npx',
      ['--yes', '@agentclientprotocol/claude-agent-acp'],
      expect.objectContaining({ shell: false }),
    );
  });
});
