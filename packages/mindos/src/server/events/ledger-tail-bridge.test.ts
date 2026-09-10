import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  agentLedgerOwnerIdentity,
  completeAgentRun,
  getAgentLedgerDatabase,
  reloadAgentRunsFromDiskForTest,
  resetAgentRunsForTest,
  startAgentRun,
} from '../../agent/ledger/run-ledger.js';
import {
  getPendingPromptDatabase,
  recordPendingPrompt,
  resetPendingPromptStoreForTest,
} from '../../agent/bridges/pending-prompt-store.js';
import type { PendingRuntimePermissionSnapshot } from '../../agent/bridges/runtime-permission-bridge.js';
import { ensureFreshDist, runDriver } from '../../agent/ledger/__fixtures__/two-process-harness.mjs';
import { createMindosServerEventBus, type MindosServerEventEnvelope } from './bus.js';
import { installAgentRunLedgerBridge } from './ledger-bridge.js';
import {
  getLedgerTailBridgeStatsForTest,
  installLedgerTailBridge,
  isLedgerTailBridgeActive,
} from './ledger-tail-bridge.js';

/**
 * Lazy ledger tail bridge (spec-cross-process-run-events A): runs written by
 * OTHER processes (automation worker, standalone server, CLI) reach this
 * host's bus as `agent-run.event` within about one tick, and nothing is read
 * from sqlite while no subscriber is connected.
 */

let root = '';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await sleep(10);
  }
}

function collect(bus: ReturnType<typeof createMindosServerEventBus>) {
  const events: MindosServerEventEnvelope[] = [];
  const unsubscribe = bus.subscribe((envelope) => events.push(envelope));
  return {
    events,
    unsubscribe,
    runEvents: () => events.filter((envelope) => envelope.event.type === 'agent-run.event'),
    pendingChanged: () => events.filter((envelope) => envelope.event.type === 'run.pending-actions.changed'),
  };
}

/** Inserts a run + event row stamped with a FOREIGN owner (raw SQL, no ledger API). */
function insertForeignRun(runId: string, eventType: string, foreignPid = 424242): void {
  const db = getAgentLedgerDatabase({ create: true })!;
  const now = Date.now();
  const record = {
    id: runId,
    rootRunId: runId,
    agentKind: 'acp',
    runtimeId: 'foreign',
    displayName: 'Foreign Run',
    status: 'running',
    permissionMode: 'read',
    inputSummary: 'written by another process',
    startedAt: now,
  };
  db.prepare(`
    INSERT INTO agent_runs(id, root_run_id, parent_run_id, chat_session_id, agent_kind, runtime_id, status,
      started_at, completed_at, updated_at, owner_pid, owner_start_ts, run_json)
    VALUES (?, ?, NULL, 'chat-foreign', 'acp', 'foreign', 'running', ?, NULL, ?, ?, 1, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(runId, runId, now, now, foreignPid, JSON.stringify(record));
  db.prepare(`
    INSERT INTO agent_run_events(id, run_id, root_run_id, chat_session_id, ts, type, category, visibility, run_started_at, event_json)
    VALUES (?, ?, ?, 'chat-foreign', ?, ?, 'status', 'timeline', ?, ?)
  `).run(`evt-${runId}-${eventType}-${Math.random().toString(36).slice(2)}`, runId, runId, now, eventType, now,
    JSON.stringify({ id: `evt-${runId}-${eventType}`, runId, type: eventType, category: 'status', status: 'running', ts: now }));
}

function permissionSnapshot(requestId: string): PendingRuntimePermissionSnapshot {
  const now = Date.now();
  return {
    kind: 'runtime-permission',
    runId: 'run-store',
    requestId,
    runtime: 'codex',
    toolCallId: 'tool-store',
    toolName: 'Bash',
    options: [{ id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' }],
    action: 'command',
    risk: { level: 'low', summary: 'Read only.' },
    createdAt: now,
    expiresAt: now + 60_000,
  };
}

describe('ledger tail bridge (fast tick)', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-tail-bridge-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
    resetPendingPromptStoreForTest();
  });

  afterEach(() => {
    resetPendingPromptStoreForTest();
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    reloadAgentRunsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not tick, read the ledger, or create files while the bus has no subscribers', async () => {
    const bus = createMindosServerEventBus();
    installLedgerTailBridge(bus, { intervalMs: 20 });
    expect(isLedgerTailBridgeActive(bus)).toBe(false);
    await sleep(120);
    expect(getLedgerTailBridgeStatsForTest(bus)).toMatchObject({ ticks: 0, ledgerReads: 0 });
    expect(fs.existsSync(path.join(root, '.mindos', 'db', 'agent_runs_1.sqlite'))).toBe(false);

    const unsubscribe = bus.subscribe(() => {});
    expect(isLedgerTailBridgeActive(bus)).toBe(true);
    await waitFor(() => (getLedgerTailBridgeStatsForTest(bus)?.ticks ?? 0) > 0);
    unsubscribe();
    expect(isLedgerTailBridgeActive(bus)).toBe(false);
    const ticksAtStop = getLedgerTailBridgeStatsForTest(bus)!.ticks;
    await sleep(120);
    expect(getLedgerTailBridgeStatsForTest(bus)!.ticks).toBe(ticksAtStop);
  });

  it('installing twice returns the same uninstall and registers one source', async () => {
    const bus = createMindosServerEventBus();
    const first = installLedgerTailBridge(bus, { intervalMs: 20 });
    const second = installLedgerTailBridge(bus, { intervalMs: 20 });
    expect(second).toBe(first);
    // Written before any subscriber connects: primed as history at start.
    insertForeignRun('history-run', 'run_started');
    const collector = collect(bus);
    await sleep(100);
    // History present before the subscriber connected is never replayed.
    expect(collector.runEvents()).toEqual([]);
    first();
    expect(isLedgerTailBridgeActive(bus)).toBe(false);
    collector.unsubscribe();
  });

  it('never replays history that exists when subscribers connect, then emits new foreign rows', async () => {
    insertForeignRun('history-run', 'run_started');
    const bus = createMindosServerEventBus();
    installLedgerTailBridge(bus, { intervalMs: 20 });
    const collector = collect(bus);
    await sleep(120);
    expect(collector.runEvents()).toEqual([]);

    insertForeignRun('history-run', 'run_completed');
    await waitFor(() => collector.runEvents().length === 1);
    const envelope = collector.runEvents()[0]!.event;
    expect(envelope).toMatchObject({
      type: 'agent-run.event',
      runId: 'history-run',
      chatSessionId: 'chat-foreign',
      event: expect.objectContaining({ type: 'run_completed', category: 'status', status: 'running' }),
    });
    collector.unsubscribe();
  });

  it('skips rows written by this process because the ledger bridge already emitted them', async () => {
    const bus = createMindosServerEventBus();
    installAgentRunLedgerBridge(bus);
    installLedgerTailBridge(bus, { intervalMs: 20 });
    const collector = collect(bus);

    const run = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'self',
      displayName: 'Own Run',
      permissionMode: 'ask',
      inputSummary: 'written by this process',
      chatSessionId: 'chat-self',
    });
    await waitFor(() => collector.runEvents().length >= 1);
    completeAgentRun(run.id, { outputSummary: 'done' });
    await waitFor(() => collector.runEvents().length >= 2);
    // Several more ticks must not duplicate the own-process rows.
    await sleep(150);
    expect(collector.runEvents()).toHaveLength(2);
    expect(collector.runEvents().every((envelope) => envelope.event.type === 'agent-run.event')).toBe(true);
    collector.unsubscribe();
  });

  it('emits foreign rows while still skipping own-process rows in the same batch', async () => {
    const bus = createMindosServerEventBus();
    installLedgerTailBridge(bus, { intervalMs: 20 });
    const collector = collect(bus);
    insertForeignRun('foreign-run', 'run_started');
    startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'self',
      displayName: 'Own Run',
      permissionMode: 'ask',
      inputSummary: 'own',
    });
    await waitFor(() => collector.runEvents().length >= 1);
    await sleep(100);
    expect(collector.runEvents().map((envelope) => envelope.event.runId)).toEqual(['foreign-run']);
    collector.unsubscribe();
  });

  it('emits run.pending-actions.changed when another process bumps the store version', async () => {
    const bus = createMindosServerEventBus();
    installLedgerTailBridge(bus, { intervalMs: 20 });
    const collector = collect(bus);
    const db = getPendingPromptDatabase({ create: true })!;
    db.prepare('UPDATE agent_pending_prompts_meta SET version = version + 1, writer_pid = ?, writer_start_ts = ? WHERE id = 1')
      .run(999999, 1);
    await waitFor(() => collector.pendingChanged().length === 1);
    // The same version must not emit again on later ticks.
    await sleep(100);
    expect(collector.pendingChanged()).toHaveLength(1);
    collector.unsubscribe();
  });

  it('emits run.pending-actions.changed immediately for in-process prompt changes, once', async () => {
    const bus = createMindosServerEventBus();
    installLedgerTailBridge(bus, { intervalMs: 20 });
    const collector = collect(bus);
    recordPendingPrompt(permissionSnapshot('request-in-process'));
    // In-process notification is synchronous — no tick wait.
    expect(collector.pendingChanged()).toHaveLength(1);
    // The tail must NOT re-emit for its own writer bump on the next ticks.
    await sleep(100);
    expect(collector.pendingChanged()).toHaveLength(1);
    collector.unsubscribe();
  });

  it('emits run.pending-actions.changed when the automation state file changes', async () => {
    const bus = createMindosServerEventBus();
    installLedgerTailBridge(bus, { intervalMs: 20 });
    const collector = collect(bus);
    const automationsDir = path.join(root, '.mindos', 'automations');
    fs.mkdirSync(automationsDir, { recursive: true });
    fs.writeFileSync(path.join(automationsDir, 'state.json'), JSON.stringify({ v: 1 }));
    await waitFor(() => collector.pendingChanged().length === 1);
    fs.writeFileSync(path.join(automationsDir, 'state.json'), JSON.stringify({ v: 22222 }));
    await waitFor(() => collector.pendingChanged().length === 2);
    await sleep(100);
    expect(collector.pendingChanged()).toHaveLength(2);
    collector.unsubscribe();
  });

  it('re-primes without replaying when the mind root switches to another ledger', async () => {
    const bus = createMindosServerEventBus();
    installLedgerTailBridge(bus, { intervalMs: 20 });
    const collector = collect(bus);
    insertForeignRun('run-root-a', 'run_started');
    await waitFor(() => collector.runEvents().length === 1);

    // Switch to a second root whose ledger already holds history: the new
    // file must be primed silently, not replayed.
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-tail-bridge-b-'));
    try {
      setMindRootResolverForTests(() => rootB);
      insertForeignRun('run-root-b', 'run_started');
      await sleep(150);
      expect(collector.runEvents().filter((envelope) => envelope.event.runId === 'run-root-b')).toEqual([]);

      insertForeignRun('run-root-b', 'run_completed');
      await waitFor(() => collector.runEvents().some((envelope) => envelope.event.runId === 'run-root-b'));
      const bEvents = collector.runEvents().filter((envelope) => envelope.event.runId === 'run-root-b');
      expect(bEvents).toHaveLength(1);
      expect((bEvents[0]!.event as { event: { type: string } }).event.type).toBe('run_completed');
    } finally {
      fs.rmSync(rootB, { recursive: true, force: true });
    }
    collector.unsubscribe();
  });
});

describe('ledger tail bridge across real processes', () => {
  beforeAll(() => {
    ensureFreshDist();
  }, 180_000);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-tail-bridge-2p-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
    resetPendingPromptStoreForTest();
  });

  afterEach(() => {
    resetPendingPromptStoreForTest();
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    reloadAgentRunsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a run written by a child process reaches the parent bus within ~2s (default 1s tick)', async () => {
    const bus = createMindosServerEventBus();
    installAgentRunLedgerBridge(bus);
    installLedgerTailBridge(bus);
    const collector = collect(bus);
    // Let the source prime while the ledger does not exist yet.
    await sleep(50);
    expect(getLedgerTailBridgeStatsForTest(bus)).toMatchObject({ ledgerReads: 0 });

    const spawnedAt = Date.now();
    const child = await runDriver(root, 'start-and-complete', 'tail-bridge-child-run');
    const exitedAt = Date.now();
    expect(child.pid).not.toBe(process.pid);
    expect(child.runtime).toBe('node');

    await waitFor(
      () => collector.runEvents().some((envelope) => envelope.event.runId === 'tail-bridge-child-run'),
      5_000,
    );
    const receivedAt = Date.now();
    const matched = collector.runEvents().filter((envelope) => envelope.event.runId === 'tail-bridge-child-run');
    const types = matched.map((envelope) => (envelope.event as { event: { type: string } }).event.type);
    expect(types).toContain('run_started');
    expect(types).toContain('run_completed');
    expect(matched.every((envelope) => envelope.event.type === 'agent-run.event')).toBe(true);

    const latencyFromExit = receivedAt - exitedAt;
    // Measured latency is reported for the handoff; the contract is ≤ 2s.
    console.log(`[ledger-tail-bridge] cross-process latency: ${latencyFromExit}ms after child exit (${receivedAt - spawnedAt}ms after spawn), ${matched.length} events`);
    expect(latencyFromExit).toBeLessThanOrEqual(2_000);

    // The child process is gone; its owner identity differs from ours, and no
    // duplicate emissions arrive on later ticks.
    const countAtReceive = matched.length;
    await sleep(1_500);
    expect(collector.runEvents().filter((envelope) => envelope.event.runId === 'tail-bridge-child-run'))
      .toHaveLength(countAtReceive);
    expect(agentLedgerOwnerIdentity().pid).not.toBe(child.pid);
    collector.unsubscribe();
  }, 60_000);
});
