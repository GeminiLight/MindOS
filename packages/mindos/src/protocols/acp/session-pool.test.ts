import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcpRegistryEntry } from './types.js';
import {
  closeSession,
  createSessionFromEntry,
  getActiveSessions,
  getSession,
  promptStream,
  cancelPrompt,
} from './session.js';
import { getActiveProcesses } from './subprocess.js';
import {
  parkAcpSession,
  resetAcpSessionPoolForTest,
  takePooledAcpSession,
} from './session-pool.js';
import { resetProcessSupervisorForTest } from '../../agent/runtime/process-supervisor.js';
import { runMindosAcpAgentTurn, type MindOSSSEvent } from '../../agent/turn/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ID = 'fake-acp-pool';

/** Real `node fake-acp-agent.mjs` with session/load enabled, so a parked session is resumable. */
function fakePoolEntry(): AcpRegistryEntry {
  return {
    id: AGENT_ID,
    name: 'Fake ACP Pool',
    description: 'Local fake ACP agent used for session-pool integration tests',
    transport: 'binary',
    command: process.execPath,
    args: [path.join(__dirname, '__fixtures__', 'fake-acp-agent.mjs')],
  };
}

function acpOptions(cwd: string, signal?: AbortSignal) {
  return {
    cwd,
    env: { FAKE_ACP_LOAD_SESSION: '1' },
    permissionMode: 'auto' as const,
    ...(signal ? { signal } : {}),
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`ACP child ${pid} is still alive after ${timeoutMs}ms`);
}

function livePoolAgentPids(): number[] {
  return getActiveProcesses()
    .filter((proc) => proc.agentId === AGENT_ID && proc.proc.pid)
    .map((proc) => proc.proc.pid as number);
}

describe('ACP session pool (real fake agent over stdio)', () => {
  let workDir: string;
  let savedPoolSwitch: string | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'mindos-acp-pool-'));
    savedPoolSwitch = process.env.MINDOS_RUNTIME_PROCESS_POOL;
    delete process.env.MINDOS_RUNTIME_PROCESS_POOL;
  });

  afterEach(async () => {
    resetAcpSessionPoolForTest();
    const pids = livePoolAgentPids();
    await Promise.allSettled(getActiveSessions().map((session) => closeSession(session.id)));
    resetAcpSessionPoolForTest();
    resetProcessSupervisorForTest();
    if (savedPoolSwitch === undefined) delete process.env.MINDOS_RUNTIME_PROCESS_POOL;
    else process.env.MINDOS_RUNTIME_PROCESS_POOL = savedPoolSwitch;
    await Promise.allSettled(pids.map((pid) => waitForExit(pid).catch(() => {})));
    rmSync(workDir, { recursive: true, force: true });
  });

  /** Lane services wired to the real session layer + the real session pool. */
  function buildServices(onCreate: () => void) {
    return {
      createSession: async (_agentId: string, options: { cwd: string; signal?: AbortSignal }) => {
        onCreate();
        return createSessionFromEntry(fakePoolEntry(), acpOptions(options.cwd, options.signal));
      },
      promptStream: async (
        sessionId: string,
        prompt: string,
        onUpdate: (update: never) => void,
        options?: { signal?: AbortSignal; timeoutMs?: number },
      ) => {
        await promptStream(sessionId, prompt, onUpdate as never, options);
      },
      cancelPrompt,
      closeSession,
      acquireSession: async (key: { agentId: string; cwd: string; externalSessionId: string }) =>
        takePooledAcpSession(key),
      releaseSession: (
        session: { id: string },
        key: { agentId: string; cwd: string; externalSessionId: string },
      ) => parkAcpSession(session.id, key),
    };
  }

  function runTurn(input: { prompt: string; externalSessionId?: string; services: ReturnType<typeof buildServices>; promptOverride?: typeof promptStream }) {
    const events: MindOSSSEvent[] = [];
    const services = input.promptOverride
      ? { ...input.services, promptStream: async (id: string, p: string, onUpdate: (u: never) => void, opts?: unknown) => input.promptOverride!(id, p, onUpdate as never, opts as never) }
      : input.services;
    const result = runMindosAcpAgentTurn({
      agentId: AGENT_ID,
      cwd: workDir,
      prompt: input.prompt,
      ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
      timeoutMs: 15_000,
      hasContent: () => events.some((event) => event.type === 'text_delta'),
      send: (event) => events.push(event),
      sleep: async () => {},
      ...services,
    });
    return {
      events,
      result,
      bindingExternalSessionId: () => {
        const binding = events.find((event) => event.type === 'runtime_binding'
          && event.runtime === 'acp'
          && event.status === 'active');
        return binding && binding.type === 'runtime_binding' ? binding.externalSessionId : undefined;
      },
      text: () => events.filter((event) => event.type === 'text_delta').map((event) => (event.type === 'text_delta' ? event.delta : '')).join(''),
    };
  }

  it('reuses one live agent across two turns (one spawn, one handshake)', async () => {
    let creates = 0;
    const services = buildServices(() => { creates += 1; });

    const first = runTurn({ prompt: 'one', services });
    const firstResult = await first.result;
    expect(firstResult.error).toBeUndefined();
    const externalSessionId = first.bindingExternalSessionId();
    expect(externalSessionId).toBeTruthy();
    expect(first.text()).toContain('fake acp ok');
    expect(creates).toBe(1);
    const pidsAfterFirst = livePoolAgentPids();
    expect(pidsAfterFirst).toHaveLength(1);

    const second = runTurn({ prompt: 'two', externalSessionId, services });
    const secondResult = await second.result;
    expect(secondResult.error).toBeUndefined();
    expect(second.text()).toContain('fake acp ok');

    // The second turn reused the parked session: no new create, no new process.
    expect(creates).toBe(1);
    expect(livePoolAgentPids()).toEqual(pidsAfterFirst);
  });

  it('parks the session on a retryable error so the retry reuses the one spawned agent', async () => {
    let creates = 0;
    const services = buildServices(() => { creates += 1; });
    let promptCalls = 0;

    const first = runTurn({ prompt: 'one', services });
    const firstResult = await first.result;
    const externalSessionId = first.bindingExternalSessionId();
    expect(firstResult.error).toBeUndefined();
    const pids = livePoolAgentPids();
    expect(pids).toHaveLength(1);

    // Turn 2: the first prompt attempt fails transiently, the retry must reuse
    // the parked session rather than spawn a second agent.
    const flaky = async (
      sessionId: string,
      prompt: string,
      onUpdate: (update: never) => void,
      options?: { signal?: AbortSignal; timeoutMs?: number },
    ) => {
      promptCalls += 1;
      if (promptCalls === 1) throw new Error('socket hang up');
      await promptStream(sessionId, prompt, onUpdate as never, options);
    };
    const second = runTurn({ prompt: 'two', externalSessionId, services, promptOverride: flaky });
    const secondResult = await second.result;

    expect(secondResult.error).toBeUndefined();
    expect(promptCalls).toBe(2);
    expect(creates).toBe(1);
    expect(livePoolAgentPids()).toEqual(pids);
  });

  it('evicts a parked session (and its agent process) once the idle TTL elapses', async () => {
    const session = await createSessionFromEntry(fakePoolEntry(), acpOptions(workDir));
    const pid = livePoolAgentPids()[0];
    expect(pid).toBeTypeOf('number');
    const key = { agentId: AGENT_ID, cwd: workDir, externalSessionId: session.agentSessionId as string };

    expect(parkAcpSession(session.id, key, { idleTtlMs: 150 })).toBe(true);
    // Before the TTL the session is still parked and reusable.
    expect(getSession(session.id)).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(getSession(session.id)).toBeUndefined();
    await waitForExit(pid as number);
  });

  it('admission evicts the least-recently-parked session to free a slot', async () => {
    const parked = [];
    for (let i = 0; i < 3; i += 1) {
      const session = await createSessionFromEntry(fakePoolEntry(), acpOptions(workDir));
      expect(parkAcpSession(session.id, {
        agentId: AGENT_ID,
        cwd: workDir,
        externalSessionId: session.agentSessionId as string,
      })).toBe(true);
      parked.push(session);
      // Distinct parkedAt so "least recently parked" is deterministic.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const fourth = await createSessionFromEntry(fakePoolEntry(), acpOptions(workDir));
    expect(getSession(fourth.id)).toBeDefined();
    // The least-recently-parked (first) session was evicted to free the slot.
    expect(getSession(parked[0]!.id)).toBeUndefined();
    expect(getActiveSessions().filter((s) => s.agentId === AGENT_ID)).toHaveLength(3);
  });

  it('admission still throws when the agent limit is held by active (unparked) sessions', async () => {
    for (let i = 0; i < 3; i += 1) {
      await createSessionFromEntry(fakePoolEntry(), acpOptions(workDir));
    }
    expect(getActiveSessions().filter((s) => s.agentId === AGENT_ID)).toHaveLength(3);

    await expect(createSessionFromEntry(fakePoolEntry(), acpOptions(workDir)))
      .rejects.toThrow(/Maximum concurrent sessions for agent/);
  });
});
