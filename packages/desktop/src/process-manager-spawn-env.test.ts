import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();
const execFileMock = vi.fn();
const existsSyncMock = vi.fn().mockReturnValue(true);
const readFileSyncMock = vi.fn().mockReturnValue('{}');

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

import { ProcessManager } from './process-manager';

type FakeProc = EventEmitter & { killed: boolean; kill: () => void; pid: number; stdout: EventEmitter; stderr: EventEmitter };

function makeFakeProcess(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  proc.pid = Math.floor(Math.random() * 90000) + 10000;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

function spawnEnvFor(which: 'mcp' | 'web'): Record<string, string> {
  // start() spawns MCP first, then web
  const call = spawnMock.mock.calls[which === 'mcp' ? 0 : 1];
  expect(call).toBeDefined();
  return (call[2] as { env: Record<string, string> }).env;
}

async function startManager(env?: Record<string, string>): Promise<ProcessManager> {
  spawnMock.mockImplementation(() => makeFakeProcess());
  const pm = new ProcessManager({
    nodePath: '/usr/bin/node',
    npxPath: '/usr/bin/npx',
    projectRoot: '/fake',
    webPort: 3456,
    mcpPort: 8781,
    mindRoot: '/fake/mind',
    env,
  });
  (pm as any).waitForReady = vi.fn().mockResolvedValue(true);
  (pm as any).checkMcpHealth = vi.fn().mockResolvedValue(false);
  await pm.start();
  return pm;
}

describe('ProcessManager child env sanitising', () => {
  let pm: ProcessManager | null = null;
  const savedInvocationId = process.env.INVOCATION_ID;
  const savedLaunchd = process.env.LAUNCHED_BY_LAUNCHD;

  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    if (pm) (pm as any).stopped = true;
    pm = null;
    if (savedInvocationId === undefined) delete process.env.INVOCATION_ID; else process.env.INVOCATION_ID = savedInvocationId;
    if (savedLaunchd === undefined) delete process.env.LAUNCHED_BY_LAUNCHD; else process.env.LAUNCHED_BY_LAUNCHD = savedLaunchd;
  });

  it('strips systemd/launchd daemon markers from the MCP child env (explicit env)', async () => {
    pm = await startManager({ PATH: '/usr/bin', INVOCATION_ID: 'abc-123', LAUNCHED_BY_LAUNCHD: '1', KEEP_ME: 'yes' });

    const env = spawnEnvFor('mcp');
    // The MCP server disables its stdin parent-death watchdog when either marker
    // is present, which would orphan it under GNOME autostart / systemd sessions.
    expect(env).not.toHaveProperty('INVOCATION_ID');
    expect(env).not.toHaveProperty('LAUNCHED_BY_LAUNCHD');
    expect(env.KEEP_ME).toBe('yes');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.MCP_TRANSPORT).toBe('http');
    expect(env.MCP_PORT).toBe('8781');
  });

  it('strips the daemon markers from the web child env as well', async () => {
    pm = await startManager({ PATH: '/usr/bin', INVOCATION_ID: 'abc-123', LAUNCHED_BY_LAUNCHD: '1' });

    const env = spawnEnvFor('web');
    expect(env).not.toHaveProperty('INVOCATION_ID');
    expect(env).not.toHaveProperty('LAUNCHED_BY_LAUNCHD');
    expect(env.MINDOS_WEB_PORT).toBe('3456');
    expect(env.MINDOS_MANAGED).toBe('1');
  });

  it('strips the daemon markers when falling back to the parent process env', async () => {
    process.env.INVOCATION_ID = 'systemd-session';
    process.env.LAUNCHED_BY_LAUNCHD = '1';

    pm = await startManager(undefined);

    for (const which of ['mcp', 'web'] as const) {
      const env = spawnEnvFor(which);
      expect(env).not.toHaveProperty('INVOCATION_ID');
      expect(env).not.toHaveProperty('LAUNCHED_BY_LAUNCHD');
    }
  });

  it('does not touch envs that never had the markers', async () => {
    pm = await startManager({ PATH: '/usr/bin', HOME: '/home/u' });

    const env = spawnEnvFor('mcp');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    expect(env).not.toHaveProperty('INVOCATION_ID');
  });
});
