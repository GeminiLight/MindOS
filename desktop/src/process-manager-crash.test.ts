import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();
const existsSyncMock = vi.fn().mockReturnValue(true);
const readFileSyncMock = vi.fn().mockReturnValue('{}');

vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

import { ProcessManager } from './process-manager';

function makeFakeProcess(): EventEmitter & { killed: boolean; kill: () => void; pid: number; stdout: EventEmitter; stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & { killed: boolean; kill: () => void; pid: number; stdout: EventEmitter; stderr: EventEmitter };
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  proc.pid = Math.floor(Math.random() * 90000) + 10000;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('ProcessManager crash handler race condition', () => {
  let pm: ProcessManager;
  let mcpProc: ReturnType<typeof makeFakeProcess>;
  let webProc: ReturnType<typeof makeFakeProcess>;

  beforeEach(async () => {
    mcpProc = makeFakeProcess();
    webProc = makeFakeProcess();
    let callCount = 0;
    spawnMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return mcpProc;
      if (callCount === 2) return webProc;
      return makeFakeProcess();
    });

    pm = new ProcessManager({
      nodePath: '/usr/bin/node',
      npxPath: '/usr/bin/npx',
      projectRoot: '/fake',
      webPort: 3456,
      mcpPort: 8781,
      mindRoot: '/fake/mind',
    });

    // Skip the health check by stubbing waitForReady to resolve immediately
    (pm as any).waitForReady = vi.fn().mockResolvedValue(true);

    await pm.start();
  });

  afterEach(async () => {
    (pm as any).stopped = true;
  });

  it('does not respawn MCP when mcpRestartInProgress is set', async () => {
    const spawnCallsBefore = spawnMock.mock.calls.length;

    // Simulate /api/mcp/restart killing MCP
    pm.suppressMcpCrashRestart();
    mcpProc.emit('exit', null, 'SIGKILL');

    // Wait for any potential setTimeout to fire
    await new Promise(r => setTimeout(r, 50));

    expect(spawnMock.mock.calls.length).toBe(spawnCallsBefore);
  });

  it('crash handler respawns MCP on genuine crash (after delay)', async () => {
    vi.useFakeTimers();

    const spawnCallsBefore = spawnMock.mock.calls.length;

    mcpProc.emit('exit', 1, null);

    // Before delay: no respawn yet
    expect(spawnMock.mock.calls.length).toBe(spawnCallsBefore);

    // After 1s delay: should respawn
    await vi.advanceTimersByTimeAsync(1500);

    expect(spawnMock.mock.calls.length).toBe(spawnCallsBefore + 1);
    vi.useRealTimers();
  });

  it('suppressMcpCrashRestart resets crash count', () => {
    (pm as any).crashCount.mcp = 2;
    pm.suppressMcpCrashRestart();
    expect((pm as any).crashCount.mcp).toBe(0);
  });

  it('mcpRestartInProgress flag is cleared after one suppressed exit', () => {
    pm.suppressMcpCrashRestart();
    expect((pm as any).mcpRestartInProgress).toBe(true);

    mcpProc.emit('exit', null, 'SIGKILL');

    expect((pm as any).mcpRestartInProgress).toBe(false);
  });

  it('does not respawn after 3 genuine MCP crashes', async () => {
    vi.useFakeTimers();

    const spawnCallsBefore = spawnMock.mock.calls.length;

    // Crash 1
    mcpProc.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1500);
    // Crash 2
    const proc2 = spawnMock.mock.results.at(-1)?.value;
    if (proc2?.emit) proc2.emit('exit', 1, null);
    else mcpProc.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(4000);
    // Crash 3
    const proc3 = spawnMock.mock.results.at(-1)?.value;
    if (proc3?.emit) proc3.emit('exit', 1, null);
    else mcpProc.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(4000);

    // After 3 crashes, crashCount.mcp >= 3, no more respawns
    // spawnCallsBefore + 2 = two respawns (crash 1 and 2 each trigger one)
    // crash 3 does NOT trigger a respawn
    expect(spawnMock.mock.calls.length).toBe(spawnCallsBefore + 2);

    vi.useRealTimers();
  });
});
