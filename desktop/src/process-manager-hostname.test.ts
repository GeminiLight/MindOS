/**
 * Test that ProcessManager correctly sets HOSTNAME=127.0.0.1 for Web process
 * to ensure health checks don't timeout when parent process has different HOSTNAME
 * @see wiki/80-known-pitfalls.md — "Next 生产进程绑定机器 hostname"
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
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

describe('ProcessManager hostname binding', () => {
  beforeEach(() => {
    spawnMock.mockClear();
    spawnMock.mockImplementation(() => makeFakeProcess());
  });

  it('should always set HOSTNAME=127.0.0.1 for web process (unconditional)', async () => {
    const pm = new ProcessManager({
      nodePath: '/usr/bin/node',
      npxPath: '/usr/bin/npx',
      projectRoot: '/fake',
      webPort: 3456,
      mcpPort: 8781,
      mindRoot: '/fake/mind',
    });

    (pm as any).waitForReady = vi.fn().mockResolvedValue(true);

    try {
      await pm.start();
    } catch {
      // ignore startup errors
    }

    // spawnMock is called with (nodePath, [script], { cwd, env, stdio })
    // First call is for MCP, second is for Web
    const allCalls = spawnMock.mock.calls;
    expect(allCalls.length).toBeGreaterThanOrEqual(2);

    // Find the web spawn call (contains app/.next/standalone/server.js or similar)
    const webCall = allCalls.find((call) => {
      const scriptPath = call[1]?.[0];
      return typeof scriptPath === 'string' && (
        scriptPath.includes('server.js') || 
        scriptPath.includes('.bin/next')
      );
    });

    expect(webCall).toBeDefined();
    const [, , options] = webCall!;
    expect(options?.env?.HOSTNAME).toBe('127.0.0.1');
  });

  it('should override parent HOSTNAME env variable', async () => {
    const pm = new ProcessManager({
      nodePath: '/usr/bin/node',
      npxPath: '/usr/bin/npx',
      projectRoot: '/fake',
      webPort: 3456,
      mcpPort: 8781,
      mindRoot: '/fake/mind',
      // Simulate parent process with different HOSTNAME
      env: {
        HOSTNAME: 'my-machine.local',
        PATH: '/usr/bin',
      },
    });

    (pm as any).waitForReady = vi.fn().mockResolvedValue(true);

    try {
      await pm.start();
    } catch {
      // ignore
    }

    const allCalls = spawnMock.mock.calls;
    const webCall = allCalls.find((call) => {
      const scriptPath = call[1]?.[0];
      return typeof scriptPath === 'string' && (
        scriptPath.includes('server.js') || 
        scriptPath.includes('.bin/next')
      );
    });

    expect(webCall).toBeDefined();
    const [, , options] = webCall!;
    // Should override parent's HOSTNAME
    expect(options?.env?.HOSTNAME).toBe('127.0.0.1');
    expect(options?.env?.HOSTNAME).not.toBe('my-machine.local');
  });

  it('should ensure health check can reach 127.0.0.1 (same binding)', async () => {
    const pm = new ProcessManager({
      nodePath: '/usr/bin/node',
      npxPath: '/usr/bin/npx',
      projectRoot: '/fake',
      webPort: 3456,
      mcpPort: 8781,
      mindRoot: '/fake/mind',
    });

    (pm as any).waitForReady = vi.fn().mockResolvedValue(true);

    try {
      await pm.start();
    } catch {
      // ignore
    }

    const allCalls = spawnMock.mock.calls;
    const webCall = allCalls.find((call) => {
      const scriptPath = call[1]?.[0];
      return typeof scriptPath === 'string' && (
        scriptPath.includes('server.js') || 
        scriptPath.includes('.bin/next')
      );
    });

    expect(webCall).toBeDefined();
    const [, , options] = webCall!;
    
    // Web process binds to HOSTNAME
    const webHostname = options?.env?.HOSTNAME;
    
    // Health check probes 127.0.0.1
    const healthCheckTarget = '127.0.0.1';
    
    // Both must match for health check to succeed
    expect(webHostname).toBe(healthCheckTarget);
  });
});
