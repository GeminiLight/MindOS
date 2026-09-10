import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AcpRegistryEntry } from './types.js';
import {
  closeSession,
  createSessionFromEntry,
  getActiveSessions,
  getSessionSnapshot,
  promptStream,
  setConfigOption,
  setMode,
} from './session.js';
import { getActiveProcesses } from './subprocess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeAgentEntry(): AcpRegistryEntry {
  return {
    id: 'fake-acp-smoke',
    name: 'Fake ACP Smoke',
    description: 'Local fake ACP agent used for stdio admission tests',
    transport: 'binary',
    command: process.execPath,
    args: [path.join(__dirname, '__fixtures__', 'fake-acp-agent.mjs')],
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`ACP child ${pid} is still alive after ${timeoutMs}ms`);
}

/** Pid of the fake agent spawned by an in-flight create (the handshake is hanging). */
async function pidOfPendingFakeAgent(): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const proc = getActiveProcesses().find((entry) => entry.agentId === 'fake-acp-smoke');
    if (proc?.proc.pid) return proc.proc.pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('fake ACP agent was not spawned');
}

describe('ACP stdio smoke', () => {
  it('projects real ACP session controls, commands, tools, and permission events', async () => {
    const session = await createSessionFromEntry(fakeAgentEntry(), {
      cwd: process.cwd(),
      permissionMode: 'auto',
    });
    try {
      let snapshot = getSessionSnapshot(session.id);
      expect(snapshot).toMatchObject({
        agentId: 'fake-acp-smoke',
        controls: {
          model: {
            status: 'available',
            configId: 'model',
            currentValue: 'cheap',
            options: [
              { id: 'cheap', label: 'Cheap' },
              { id: 'smart', label: 'Smart' },
            ],
          },
          thoughtLevel: {
            status: 'available',
            configId: 'reasoning_effort',
            currentValue: 'low',
          },
          mode: {
            status: 'available',
            currentValue: 'default',
          },
        },
      });

      await setMode(session.id, 'code');
      await setConfigOption(session.id, 'model', 'smart');
      await setConfigOption(session.id, 'reasoning_effort', 'high');

      const updates: string[] = [];
      const response = await promptStream(session.id, 'hello fake acp', (update) => {
        updates.push(update.type);
      });

      expect(response.text).toContain('fake acp ok: code/smart/high');
      expect(updates).toEqual(expect.arrayContaining([
        'available_commands_update',
        'current_mode_update',
        'config_option_update',
        'tool_call',
        'permission_request',
        'permission_resolved',
        'tool_call_update',
        'agent_message_chunk',
        'session_info_update',
        'done',
      ]));

      snapshot = getSessionSnapshot(session.id);
      expect(snapshot?.controls.model.currentValue).toBe('smart');
      expect(snapshot?.controls.thoughtLevel.currentValue).toBe('high');
      expect(snapshot?.controls.mode.currentValue).toBe('code');
      expect(snapshot?.availableCommands.map((command) => command.name)).toEqual(['plan', 'inspect']);
      expect(snapshot?.toolSummary).toMatchObject({
        total: 1,
        completed: 1,
      });
      expect(snapshot?.permissionEvents).toHaveLength(1);
      expect(snapshot?.permissionEvents[0]).toMatchObject({
        status: 'resolved',
        toolCallId: 'fake-tool-1',
        toolName: 'Inspect workspace',
        selectedOptionId: 'allow',
        outcome: 'allow_once',
      });
      expect(snapshot?.pendingPermissions).toEqual([]);
      expect(snapshot?.sessionInfo?.title).toBe('Fake ACP Smoke Session');
    } finally {
      await closeSession(session.id);
    }
  });
});

describe('ACP stdio handshake timeouts', () => {
  it('kills the agent, reports the timeout and releases the slot when initialize never answers', async () => {
    const startedAt = Date.now();
    const pending = createSessionFromEntry(fakeAgentEntry(), {
      cwd: process.cwd(),
      env: { FAKE_ACP_HANG: 'initialize' },
      timeouts: { initialize: 300 },
    });
    const expectation = expect(pending).rejects.toThrow(/initialize timed out after 0\.3s/);
    const pid = await pidOfPendingFakeAgent();
    await expectation;

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(getActiveSessions()).toHaveLength(0);
    expect(getActiveProcesses().filter((proc) => proc.agentId === 'fake-acp-smoke')).toHaveLength(0);
    await waitForExit(pid);

    const healthy = await createSessionFromEntry(fakeAgentEntry(), { cwd: process.cwd() });
    await closeSession(healthy.id);
  });

  it('kills the agent and releases the slot when session/new never answers', async () => {
    const pending = createSessionFromEntry(fakeAgentEntry(), {
      cwd: process.cwd(),
      env: { FAKE_ACP_HANG: 'session/new' },
      timeouts: { sessionOpen: 300 },
    });
    const expectation = expect(pending).rejects.toThrow(/session\/new timed out after 0\.3s/);
    const pid = await pidOfPendingFakeAgent();
    await expectation;

    expect(getActiveSessions()).toHaveLength(0);
    await waitForExit(pid);

    const healthy = await createSessionFromEntry(fakeAgentEntry(), { cwd: process.cwd() });
    await closeSession(healthy.id);
  });

  it('kills the agent after the close timeout when session/close never answers', async () => {
    const session = await createSessionFromEntry(fakeAgentEntry(), {
      cwd: process.cwd(),
      env: { FAKE_ACP_HANG: 'session/close' },
      timeouts: { close: 300 },
    });
    const pid = getActiveProcesses().find((proc) => proc.agentId === 'fake-acp-smoke')?.proc.pid;
    expect(pid).toBeTypeOf('number');

    const startedAt = Date.now();
    await closeSession(session.id);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(getActiveSessions()).toHaveLength(0);
    await waitForExit(pid!);
  });
});
