import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindosHttpServices } from '../services.js';

/**
 * Spawn-budget regression guard. Every `checkProcessVersion` call spawns a
 * child (`codex app-server --help`, `codex login status`, `claude --version`);
 * this file counts them through a fake `spawn` so the number of child
 * processes per request stays a contract rather than an accident.
 *
 * Before the detection cache one full request cost 3 spawns and the Agents
 * panel (six projection routes + readiness, concurrently) re-entered the
 * handler seven times: 7 × 3 = 21 spawns for one panel mount, 27 once the
 * picker request is added (measured with this file against the old handler).
 */
const spawnCalls: Array<{ command: string; args: string[] }> = [];

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        killed: boolean;
        kill(): void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => { child.killed = true; };
      setTimeout(() => {
        child.stdout.emit('data', 'ok\n');
        child.emit('exit', 0);
      }, 0);
      return child;
    },
  };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: () => undefined }));

const { createMindosApp } = await import('../app.js');
const { createDefaultMindosHttpServices } = await import('../services.js');
const { handleAgentRuntimesGet } = await import('./agent-runtimes.js');
const { resetRuntimeDetectionCacheForTest } = await import('./runtime-detection-cache.js');

const cleanups: Array<() => void> = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mindos-spawn-budget-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Product-default health checks (real `spawn` path) with injected command resolution so no PATH lookup happens. */
function detectionOverrides(root: string) {
  return {
    detectLocalAcpAgents: async () => ({ installed: [], notInstalled: [] }),
    resolveRuntimeCommand: async (command: string) => (command === 'codex' || command === 'claude' ? `/opt/bin/${command}` : null),
    resolveRuntimeCommandCandidates: async () => [],
    readSettings: () => ({
      mindRoot: root,
      // CODEX_HOME keeps the provider-environment check away from the real ~/.codex/config.toml;
      // an empty PATH keeps the Codex candidate plan away from whatever this machine has installed.
      acpAgents: { codex: { env: { CODEX_HOME: join(root, 'codex-home'), PATH: join(root, 'empty-bin') } } },
    }),
  };
}

function makeServices(root: string): MindosHttpServices {
  const overrides = detectionOverrides(root);
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    readSettings: overrides.readSettings,
  });
  cleanups.push(() => services.dispose?.());
  return {
    ...services,
    agentRuntimes: {
      detectLocalAcpAgents: overrides.detectLocalAcpAgents,
      resolveRuntimeCommand: overrides.resolveRuntimeCommand,
      resolveRuntimeCommandCandidates: overrides.resolveRuntimeCommandCandidates,
    },
  };
}

const PANEL_ROUTES = [
  '/api/agent-runtimes/mcp-projections',
  '/api/agent-runtimes/adapter-projections',
  '/api/agent-runtimes/permission-projections',
  '/api/agent-runtimes/session-projections',
  '/api/agent-runtimes/artifact-projections',
  '/api/agent-runtimes/automation-projections',
  '/api/agent-runtimes/readiness',
];

beforeEach(() => {
  spawnCalls.length = 0;
  resetRuntimeDetectionCacheForTest();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  resetRuntimeDetectionCacheForTest();
});

describe('runtime detection spawn budget', () => {
  it('spends exactly three child processes on a cold full detection', async () => {
    const root = makeRoot();
    const res = await handleAgentRuntimesGet(new URLSearchParams(), detectionOverrides(root));

    expect(res.status).toBe(200);
    expect(spawnCalls.map((call) => `${call.command} ${call.args.join(' ')}`).sort()).toEqual([
      '/opt/bin/claude --version',
      '/opt/bin/codex app-server --help',
      '/opt/bin/codex login status',
    ]);
  });

  it('serves a cold Agents panel mount (six projections + readiness, concurrent) from three child processes total', async () => {
    const root = makeRoot();
    const app = createMindosApp({ services: makeServices(root), auth: 'host', staticFallback: false });

    const responses = await Promise.all(PANEL_ROUTES.map((path) => app.fetch(new Request(`http://localhost${path}`))));

    for (const [index, res] of responses.entries()) {
      expect(res.status, PANEL_ROUTES[index]).toBe(200);
    }
    console.info(`[spawn-budget] agents panel mount: before=21 after=${spawnCalls.length}`);
    expect(spawnCalls).toHaveLength(3);
  });

  it('adds no child process when the picker and the panel follow a warm cache', async () => {
    const root = makeRoot();
    const services = makeServices(root);
    const app = createMindosApp({ services, auth: 'host', staticFallback: false });

    await app.fetch(new Request('http://localhost/api/agent-runtimes'));
    const warm = spawnCalls.length;
    await Promise.all([
      app.fetch(new Request('http://localhost/api/agent-runtimes?runtime=codex')),
      app.fetch(new Request('http://localhost/api/agent-runtimes?runtime=claude')),
      app.fetch(new Request('http://localhost/api/agent-runtimes?scope=acp')),
      ...PANEL_ROUTES.map((path) => app.fetch(new Request(`http://localhost${path}`))),
    ]);

    expect(warm).toBe(3);
    console.info(`[spawn-budget] picker + panel: before=27 after=${spawnCalls.length}`);
    expect(spawnCalls).toHaveLength(3);
  });
});
