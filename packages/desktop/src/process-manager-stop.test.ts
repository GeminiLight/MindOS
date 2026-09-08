import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();
const execFileMock = vi.fn();
const existsSyncMock = vi.fn().mockReturnValue(true);
const readFileSyncMock = vi.fn().mockReturnValue('{}');
const writeFileSyncMock = vi.fn();
const unlinkSyncMock = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
  unlinkSync: (...args: unknown[]) => unlinkSyncMock(...args),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

import { ProcessManager } from './process-manager';

type FakeProc = EventEmitter & {
  killed: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
};

/**
 * @param exitsOn which signal makes the fake child actually emit 'exit'
 *   ('SIGTERM' = graceful, 'SIGKILL' = only after force kill, null = never exits)
 */
function makeFakeProcess(pid: number, exitsOn: 'SIGTERM' | 'SIGKILL' | null): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.killed = false;
  proc.pid = pid;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn((signal?: NodeJS.Signals) => {
    proc.killed = true;
    const effective = signal ?? (process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
    if (exitsOn && (effective === exitsOn || (exitsOn === 'SIGTERM' && effective === 'SIGKILL'))) {
      setTimeout(() => proc.emit('exit', null, effective), 0);
    }
    return true;
  });
  return proc;
}

function pidFileWrites(): string[] {
  return writeFileSyncMock.mock.calls
    .filter((call) => String(call[0]).endsWith('desktop-children.pid'))
    .map((call) => String(call[1]));
}

async function startManager(mcp: FakeProc, web: FakeProc): Promise<ProcessManager> {
  let n = 0;
  spawnMock.mockImplementation(() => (n++ === 0 ? mcp : web));
  const pm = new ProcessManager({
    nodePath: '/usr/bin/node',
    npxPath: '/usr/bin/npx',
    projectRoot: '/fake',
    webPort: 3456,
    mcpPort: 8781,
    mindRoot: '/fake/mind',
    env: { PATH: '/usr/bin' },
  });
  (pm as any).waitForReady = vi.fn().mockResolvedValue(true);
  (pm as any).checkMcpHealth = vi.fn().mockResolvedValue(false);
  await pm.start();
  return pm;
}

describe('ProcessManager.stop() exit confirmation', () => {
  const killSpy = vi.spyOn(process, 'kill');

  beforeEach(() => {
    spawnMock.mockReset();
    writeFileSyncMock.mockReset();
    unlinkSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);
    // Fake children do not own a process group — make the group kill a no-op
    killSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockReset();
  });

  it('resolves true and clears the PID file when both children exit on SIGTERM', async () => {
    const mcp = makeFakeProcess(1001, 'SIGTERM');
    const web = makeFakeProcess(1002, 'SIGTERM');
    const pm = await startManager(mcp, web);
    expect(pidFileWrites().at(-1)).toBe('1002\n1001');

    const clean = await pm.stop();

    expect(clean).toBe(true);
    expect(unlinkSyncMock).toHaveBeenCalledTimes(1);
    expect(String(unlinkSyncMock.mock.calls[0][0])).toMatch(/desktop-children\.pid$/);
  });

  it('keeps the PID file listing the child that never confirmed exit and resolves false', async () => {
    const mcp = makeFakeProcess(2001, 'SIGTERM');
    const web = makeFakeProcess(2002, null); // survives SIGTERM and SIGKILL
    const pm = await startManager(mcp, web);
    writeFileSyncMock.mockClear();

    const clean = await (pm as any).stop({ termTimeoutMs: 20, forceKillConfirmMs: 20 });

    expect(clean).toBe(false);
    // Next boot's heal path must still find the survivor: PID file is rewritten, not removed
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(pidFileWrites().at(-1)).toBe('2002');
  });

  it('waits for the exit event after force-kill instead of resolving immediately', async () => {
    const mcp = makeFakeProcess(3001, 'SIGTERM');
    const web = makeFakeProcess(3002, 'SIGKILL'); // ignores SIGTERM, dies on SIGKILL
    const pm = await startManager(mcp, web);

    const clean = await (pm as any).stop({ termTimeoutMs: 20, forceKillConfirmMs: 500 });

    expect(clean).toBe(true);
    expect(unlinkSyncMock).toHaveBeenCalledTimes(1);
  });
});
