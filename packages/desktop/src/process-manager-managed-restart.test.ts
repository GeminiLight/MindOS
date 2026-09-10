import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';

const spawnMock = vi.fn();
const execFileMock = vi.fn();
const fsState = vi.hoisted(() => ({
  intentPath: '',
  intentContent: null as string | null,
  unlinked: [] as string[],
}));

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock('fs', () => ({
  existsSync: (p: string) => (p === fsState.intentPath ? fsState.intentContent !== null : true),
  readFileSync: (p: string) => {
    if (p === fsState.intentPath) {
      if (fsState.intentContent === null) throw new Error('ENOENT');
      return fsState.intentContent;
    }
    return '{}';
  },
  unlinkSync: (p: string) => {
    fsState.unlinked.push(p);
    if (p === fsState.intentPath) fsState.intentContent = null;
  },
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  appendFileSync: vi.fn(),
}));
vi.mock('./desktop-home', () => ({
  getDesktopHome: () => '/fake-home',
  getDesktopConfigDir: () => path.join('/fake-home', '.mindos'),
}));

import { ProcessManager } from './process-manager';

type FakeProcess = EventEmitter & { killed: boolean; kill: () => void; pid: number; stdout: EventEmitter; stderr: EventEmitter };

function makeFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  proc.pid = Math.floor(Math.random() * 90000) + 10000;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

/**
 * /api/mcp/restart (MINDOS_MANAGED=1) kills the MCP by port after leaving an
 * intent file. The ProcessManager must treat that exit as a restart: no crash
 * count, no crash event, prompt respawn. Anything else is still a crash.
 */
describe('ProcessManager managed MCP restart intent', () => {
  let pm: ProcessManager;
  let mcpProc: FakeProcess;
  let webProc: FakeProcess;

  beforeEach(async () => {
    fsState.intentPath = path.join('/fake-home', '.mindos', 'mcp-restart.intent');
    fsState.intentContent = null;
    fsState.unlinked = [];
    mcpProc = makeFakeProcess();
    webProc = makeFakeProcess();
    let callCount = 0;
    spawnMock.mockReset();
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
    (pm as unknown as { waitForReady: () => Promise<boolean> }).waitForReady = vi.fn().mockResolvedValue(true);
    (pm as unknown as { checkMcpHealth: () => Promise<boolean> }).checkMcpHealth = vi.fn().mockResolvedValue(false);
    (pm as unknown as { waitForMcpPortFree: () => Promise<boolean> }).waitForMcpPortFree = vi.fn().mockResolvedValue(true);
    await pm.start();
  });

  afterEach(() => {
    (pm as unknown as { stopped: boolean }).stopped = true;
  });

  it('tells the Web server where the restart intent lives', () => {
    const webSpawn = spawnMock.mock.calls[1];
    expect(webSpawn).toBeDefined();
    const env = (webSpawn![2] as { env: Record<string, string> }).env;
    expect(env.MINDOS_MANAGED).toBe('1');
    expect(env.MINDOS_MCP_RESTART_INTENT).toBe(fsState.intentPath);
  });

  it('respawns after a managed restart without counting a crash', async () => {
    const crashes: unknown[] = [];
    const restarts: unknown[] = [];
    pm.on('crash', (...args) => crashes.push(args));
    pm.on('mcp-restart', (...args) => restarts.push(args));
    fsState.intentContent = JSON.stringify({ port: 8781, requestedAt: new Date().toISOString(), requestedBy: 4242 });
    const spawnCallsBefore = spawnMock.mock.calls.length;

    mcpProc.emit('exit', null, 'SIGKILL');

    expect((pm as unknown as { crashCount: { mcp: number } }).crashCount.mcp).toBe(0);
    expect(crashes).toEqual([]);
    expect(restarts).toEqual([[8781]]);
    expect(fsState.unlinked).toContain(fsState.intentPath);

    await new Promise((r) => setTimeout(r, 700));
    expect(spawnMock.mock.calls.length).toBe(spawnCallsBefore + 1);
    expect((pm as unknown as { crashCount: { mcp: number } }).crashCount.mcp).toBe(0);
  });

  it('treats a stale intent as a crash and removes it', async () => {
    const crashes: unknown[] = [];
    pm.on('crash', (...args) => crashes.push(args));
    fsState.intentContent = JSON.stringify({ port: 8781, requestedAt: new Date(Date.now() - 5 * 60_000).toISOString(), requestedBy: 4242 });

    mcpProc.emit('exit', 1, null);

    expect((pm as unknown as { crashCount: { mcp: number } }).crashCount.mcp).toBe(1);
    expect(crashes).toHaveLength(1);
    expect(fsState.unlinked).toContain(fsState.intentPath);
  });

  it('ignores an intent written for another port and an unparsable intent', () => {
    fsState.intentContent = JSON.stringify({ port: 9999, requestedAt: new Date().toISOString() });
    mcpProc.emit('exit', 1, null);
    expect((pm as unknown as { crashCount: { mcp: number } }).crashCount.mcp).toBe(1);

    // The exit listener stays attached to the emitter, so a second exit exercises the mcp handler again.
    fsState.intentContent = 'not json';
    mcpProc.emit('exit', 1, null);
    expect((pm as unknown as { crashCount: { mcp: number } }).crashCount.mcp).toBe(2);
    expect(fsState.unlinked.filter((p) => p === fsState.intentPath)).toHaveLength(2);
  });

  it('still counts a plain crash when no intent exists', () => {
    const crashes: unknown[] = [];
    pm.on('crash', (...args) => crashes.push(args));

    mcpProc.emit('exit', 1, null);

    expect((pm as unknown as { crashCount: { mcp: number } }).crashCount.mcp).toBe(1);
    expect(crashes).toHaveLength(1);
  });
});
