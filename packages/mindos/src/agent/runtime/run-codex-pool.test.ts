import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MindOSSSEvent } from '../turn/index.js';
import {
  codexAppServerPoolStatsForTest,
  resetCodexAppServerClientPoolForTest,
} from './codex-app-server-pool.js';
import { resetProcessSupervisorForTest } from './process-supervisor.js';
import { runMindosNativeAgentTurn } from './run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_APP_SERVER = path.join(__dirname, '__fixtures__', 'fake-codex-app-server.mjs');
const describeUnix = process.platform === 'win32' ? describe.skip : describe;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met in time');
}

function readLines(file: string): string[] {
  try {
    return readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Real `runMindosNativeAgentTurn` against the fake app-server over stdio, so
 * the pool, the transport and the supervisor are all exercised together.
 */
describeUnix('Codex turn lane app-server pool', () => {
  let workDir: string;
  let spawnLog: string;
  let methodLog: string;
  let savedPoolSwitch: string | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'mindos-codex-pool-'));
    spawnLog = path.join(workDir, 'spawns.log');
    methodLog = path.join(workDir, 'methods.log');
    writeFileSync(spawnLog, '');
    writeFileSync(methodLog, '');
    savedPoolSwitch = process.env.MINDOS_RUNTIME_PROCESS_POOL;
    delete process.env.MINDOS_RUNTIME_PROCESS_POOL;
  });

  afterEach(async () => {
    resetCodexAppServerClientPoolForTest();
    resetProcessSupervisorForTest();
    if (savedPoolSwitch === undefined) delete process.env.MINDOS_RUNTIME_PROCESS_POOL;
    else process.env.MINDOS_RUNTIME_PROCESS_POOL = savedPoolSwitch;
    // Give killed children a moment to exit before the temp dir goes away.
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(workDir, { recursive: true, force: true });
  });

  function runTurn(input: {
    prompt: string;
    externalSessionId?: string;
    signal?: AbortSignal;
    env?: Record<string, string>;
    cwd?: string;
  }) {
    const events: MindOSSSEvent[] = [];
    const startedAt = Date.now();
    let firstEventAt: number | undefined;
    const result = runMindosNativeAgentTurn({
      runtime: {
        kind: 'codex',
        id: 'codex',
        name: 'Codex',
        binaryPath: FAKE_APP_SERVER,
        ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
      },
      cwd: input.cwd ?? workDir,
      prompt: input.prompt,
      timeoutMs: 10_000,
      signal: input.signal,
      runtimeEnv: {
        FAKE_CODEX_SPAWN_LOG: spawnLog,
        FAKE_CODEX_METHOD_LOG: methodLog,
        // An empty CODEX_HOME keeps the env builder away from the developer's real config.toml.
        CODEX_HOME: workDir,
        ...(input.env ?? {}),
      },
      send: (event) => {
        if (event.type === 'text_delta' && firstEventAt === undefined) firstEventAt = Date.now();
        events.push(event);
      },
    });
    return {
      events,
      result,
      timeToFirstEvent: () => (firstEventAt === undefined ? undefined : firstEventAt - startedAt),
    };
  }

  it('reuses one app-server across two turns and only initializes it once', async () => {
    const first = runTurn({ prompt: 'first' });
    const firstResult = await first.result;
    expect(firstResult.error).toBeUndefined();
    expect(firstResult.externalSessionId).toMatch(/^thr-/);
    expect(first.events.some((event) => event.type === 'text_delta' && event.delta.includes('fake codex ok: first'))).toBe(true);

    const second = runTurn({ prompt: 'second', externalSessionId: firstResult.externalSessionId });
    const secondResult = await second.result;
    expect(secondResult.error).toBeUndefined();
    expect(secondResult.externalSessionId).toBe(firstResult.externalSessionId);
    expect(second.events.some((event) => event.type === 'text_delta' && event.delta.includes('fake codex ok: second'))).toBe(true);

    expect(readLines(spawnLog)).toHaveLength(1);
    const methods = readLines(methodLog);
    expect(methods.filter((method) => method === 'initialize')).toHaveLength(1);
    expect(methods.filter((method) => method === 'thread/resume')).toHaveLength(1);
    expect(codexAppServerPoolStatsForTest().turn).toMatchObject({ created: 1, entries: 1, busy: 0 });

    const pid = Number(readLines(spawnLog)[0]);
    expect(isProcessAlive(pid)).toBe(true);
    console.info(`[codex-pool] time-to-first-event turn1=${first.timeToFirstEvent()}ms (spawn+initialize) turn2=${second.timeToFirstEvent()}ms (pooled)`);
  });

  it('respawns transparently when the pooled app-server died between turns', async () => {
    const first = await runTurn({ prompt: 'first' }).result;
    const pid = Number(readLines(spawnLog)[0]);
    process.kill(pid, 'SIGKILL');
    await waitFor(() => !isProcessAlive(pid));

    const second = runTurn({ prompt: 'after crash', externalSessionId: first.externalSessionId });
    const secondResult = await second.result;

    expect(secondResult.error).toBeUndefined();
    expect(second.events.some((event) => event.type === 'error')).toBe(false);
    expect(second.events.some((event) => event.type === 'text_delta' && event.delta.includes('after crash'))).toBe(true);
    expect(readLines(spawnLog)).toHaveLength(2);
  });

  it('keeps the app-server alive after a user cancel and reuses it for the next turn', async () => {
    const controller = new AbortController();
    const env = { FAKE_CODEX_HANG_FIRST_TURN: '1' };
    const first = runTurn({ prompt: 'hang', signal: controller.signal, env });
    await waitFor(() => first.events.some((event) => event.type === 'text_delta'));
    controller.abort(new Error('user canceled'));
    const firstResult = await first.result;
    expect(firstResult.error).toBeInstanceOf(Error);
    expect(first.events).toContainEqual({ type: 'status', visible: true, runtime: 'codex', message: 'Canceled by user.' });

    const pid = Number(readLines(spawnLog)[0]);
    expect(isProcessAlive(pid)).toBe(true);
    // Let the fake emit the late turn/completed of the interrupted turn before the next turn starts.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = runTurn({ prompt: 'resume after cancel', externalSessionId: firstResult.externalSessionId, env });
    const secondResult = await second.result;
    expect(secondResult.error).toBeUndefined();
    expect(second.events.some((event) => event.type === 'text_delta' && event.delta.includes('resume after cancel'))).toBe(true);
    expect(second.events.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(readLines(spawnLog)).toHaveLength(1);
    expect(readLines(methodLog).filter((method) => method === 'turn/interrupt')).toHaveLength(1);
  });

  it('falls back to one process per turn when MINDOS_RUNTIME_PROCESS_POOL=0', async () => {
    process.env.MINDOS_RUNTIME_PROCESS_POOL = '0';
    const first = await runTurn({ prompt: 'first' }).result;
    const pid = Number(readLines(spawnLog)[0]);
    await waitFor(() => !isProcessAlive(pid));
    await runTurn({ prompt: 'second', externalSessionId: first.externalSessionId }).result;

    expect(readLines(spawnLog)).toHaveLength(2);
    expect(readLines(methodLog).filter((method) => method === 'initialize')).toHaveLength(2);
  });

  it('keeps separate app-servers per cwd', async () => {
    const otherDir = mkdtempSync(path.join(tmpdir(), 'mindos-codex-pool-other-'));
    try {
      await runTurn({ prompt: 'a' }).result;
      await runTurn({ prompt: 'b', cwd: otherDir }).result;
      expect(readLines(spawnLog)).toHaveLength(2);
      expect(codexAppServerPoolStatsForTest().turn.entries).toBe(2);
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
