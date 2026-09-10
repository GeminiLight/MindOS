import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MindosServerEvent } from '../events/bus.js';
import { handleMcpRestartPost, resolveMcpRestartIntentPath } from './mcp-restart.js';

/**
 * Managed restarts (Desktop, MINDOS_MANAGED=1) must tell the ProcessManager
 * that the coming MCP exit is intentional, and `mcp.changed` may only fire
 * once the replacement answers /api/health.
 */

type Emitted = MindosServerEvent[];

function makeEvents(): { events: { emit(event: MindosServerEvent): void }; emitted: Emitted } {
  const emitted: Emitted = [];
  return { events: { emit: (event) => { emitted.push(event); } }, emitted };
}

describe('handleMcpRestartPost managed restart intent', () => {
  it('writes the restart intent before killing and emits mcp.changed only after health is back', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-restart-intent-'));
    const intentPath = join(home, '.mindos', 'mcp-restart.intent');
    const order: string[] = [];
    const { events, emitted } = makeEvents();
    let intentAtKill: Record<string, unknown> | null = null;

    const response = await handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9991 }),
      env: { MINDOS_MANAGED: '1' } as NodeJS.ProcessEnv,
      projectRoot: home,
      homeDir: home,
      killByPort: (port) => {
        order.push(`kill:${port}`);
        intentAtKill = existsSync(intentPath) ? JSON.parse(readFileSync(intentPath, 'utf-8')) as Record<string, unknown> : null;
      },
      waitForMcpHealth: async (port) => {
        order.push(`health:${port}`);
        expect(emitted).toEqual([]);
        return true;
      },
      events,
    });

    expect(response).toMatchObject({
      status: 200,
      body: { ok: true, port: 9991, healthy: true, note: 'ProcessManager will respawn' },
    });
    expect(order).toEqual(['kill:9991', 'health:9991']);
    expect(intentAtKill).toMatchObject({ port: 9991, requestedBy: process.pid });
    expect(typeof (intentAtKill as unknown as { requestedAt: string }).requestedAt).toBe('string');
    expect(emitted).toEqual([{ type: 'mcp.changed' }]);
  });

  it('does not emit mcp.changed when the managed MCP never comes back healthy', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-restart-intent-'));
    const { events, emitted } = makeEvents();

    const response = await handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9992 }),
      env: { MINDOS_MANAGED: '1' } as NodeJS.ProcessEnv,
      projectRoot: home,
      homeDir: home,
      killByPort: () => {},
      waitForMcpHealth: async () => false,
      events,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, port: 9992, healthy: false });
    expect((response.body as { note: string }).note).toMatch(/not healthy/i);
    expect(emitted).toEqual([]);
  });

  it('honours MINDOS_MCP_RESTART_INTENT and an explicit restartIntentPath over the home default', () => {
    expect(resolveMcpRestartIntentPath({ homeDir: '/home/x', env: {} as NodeJS.ProcessEnv }))
      .toBe(join('/home/x', '.mindos', 'mcp-restart.intent'));
    expect(resolveMcpRestartIntentPath({ homeDir: '/home/x', env: { MINDOS_MCP_RESTART_INTENT: '/tmp/custom.intent' } as NodeJS.ProcessEnv }))
      .toBe('/tmp/custom.intent');
    expect(resolveMcpRestartIntentPath({ homeDir: '/home/x', restartIntentPath: '/explicit.intent', env: { MINDOS_MCP_RESTART_INTENT: '/tmp/custom.intent' } as NodeJS.ProcessEnv }))
      .toBe('/explicit.intent');
  });

  it('writes the intent to the env-provided path when Desktop passes one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-restart-intent-'));
    const intentPath = join(home, 'desktop', 'restart.intent');

    await handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9993 }),
      env: { MINDOS_MANAGED: '1', MINDOS_MCP_RESTART_INTENT: intentPath } as NodeJS.ProcessEnv,
      projectRoot: home,
      homeDir: home,
      killByPort: () => {},
      waitForMcpHealth: async () => true,
    });

    expect(JSON.parse(readFileSync(intentPath, 'utf-8'))).toMatchObject({ port: 9993 });
  });

  it('waits for health before emitting on an unmanaged respawn as well', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-mcp-restart-unmanaged-'));
    const bundlePath = join(root, 'packages', 'mindos', 'dist', 'protocols', 'mcp-server', 'index.cjs');
    const order: string[] = [];
    const { events, emitted } = makeEvents();

    const healthy = await handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9994 }),
      env: {} as NodeJS.ProcessEnv,
      projectRoot: root,
      homeDir: root,
      execPath: '/node',
      killByPort: () => {},
      waitForPortFree: async () => true,
      pathExists: (path) => path === bundlePath,
      spawnDetached: () => { order.push('spawn'); return { pid: 7, unref: () => {} }; },
      waitForMcpHealth: async () => { order.push('health'); return true; },
      events,
    });
    expect(healthy).toMatchObject({ status: 200, body: { ok: true, pid: 7, port: 9994, healthy: true } });
    expect(order).toEqual(['spawn', 'health']);
    expect(emitted).toEqual([{ type: 'mcp.changed' }]);
    // An unmanaged restart never writes a Desktop intent file.
    expect(existsSync(join(root, '.mindos', 'mcp-restart.intent'))).toBe(false);

    const unhealthy = await handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9995 }),
      env: {} as NodeJS.ProcessEnv,
      projectRoot: root,
      homeDir: root,
      execPath: '/node',
      killByPort: () => {},
      waitForPortFree: async () => true,
      pathExists: (path) => path === bundlePath,
      spawnDetached: () => ({ pid: 8, unref: () => {} }),
      waitForMcpHealth: async () => false,
      events,
    });
    expect(unhealthy).toMatchObject({ status: 200, body: { ok: true, pid: 8, port: 9995, healthy: false } });
    expect(emitted).toHaveLength(1);
  });
});
