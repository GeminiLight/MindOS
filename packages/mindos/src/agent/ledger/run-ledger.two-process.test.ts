import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { openMindosDatabase } from '../../foundation/storage/sqlite.js';
import { ensureFreshDist, findBun, runDriver, runDriverWith } from './__fixtures__/two-process-harness.mjs';
import { LEDGER_DB_RELATIVE_PATH } from './run-ledger-db.js';
import {
  completeAgentRun,
  getAgentRun,
  listAgentEvents,
  listAgentRuns,
  reloadAgentRunsFromDiskForTest,
  resetAgentRunsForTest,
  startAgentRun,
} from './run-ledger.js';

/**
 * True multi-process ledger tests (spec-agent-core-consolidation 验收:
 * 真双进程测试; spec-sqlite-derived-stores cross-process visibility). Children
 * are real `node` processes importing the BUILT dist/ ledger, all writing the
 * same WAL-mode sqlite file with genuinely distinct pids.
 */

const bun = findBun();
if (!bun) {
  console.warn('[run-ledger.two-process.test] `bun` not found on PATH; skipping the Bun + Node mixed-runtime ledger test.');
}

let root = '';

function rawRunStatus(id: string): string | undefined {
  const db = openMindosDatabase({ file: path.join(fs.realpathSync(root), ...LEDGER_DB_RELATIVE_PATH.split('/')), migrations: [] });
  const row = db.prepare('SELECT status FROM agent_runs WHERE id = ?').get(id) as { status: string } | undefined;
  return row?.status;
}

describe('agent run ledger across real processes', () => {
  beforeAll(() => {
    ensureFreshDist();
  }, 120_000);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ledger-2p-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
  });

  afterEach(() => {
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    reloadAgentRunsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('two processes writing concurrently lose none of each other\'s runs, with no per-process shard files', async () => {
    const COUNT = 140;
    const [a, b] = await Promise.all([
      runDriver(root, 'append-many', 'proc-a', String(COUNT)),
      runDriver(root, 'append-many', 'proc-b', String(COUNT)),
    ]);
    expect(a.pid).not.toBe(b.pid);

    const mindosDir = fs.readdirSync(path.join(root, '.mindos'));
    expect(mindosDir.filter((name) => name.startsWith('agent-run-ledger.'))).toEqual([]);
    expect(fs.existsSync(path.join(root, ...LEDGER_DB_RELATIVE_PATH.split('/')))).toBe(true);

    // No reload: the parent reads the shared database directly.
    const runs = listAgentRuns({ kind: 'pi-subagent', limit: 500 });
    expect(runs).toHaveLength(COUNT * 2);
    const runtimeIds = new Set(runs.map((run) => run.runtimeId));
    for (let index = 0; index < COUNT; index += 1) {
      expect(runtimeIds.has(`proc-a-${index}`)).toBe(true);
      expect(runtimeIds.has(`proc-b-${index}`)).toBe(true);
    }
    expect(runs.every((run) => run.status === 'completed')).toBe(true);
  }, 60_000);

  it('a run created by a child process is visible to the parent without a restart, and vice versa', async () => {
    // Parent opens its handle first so nothing about the child's write is
    // observed through a cold open.
    expect(listAgentRuns()).toEqual([]);
    const parentRun = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'parent',
      displayName: 'Parent Run',
      permissionMode: 'ask',
      inputSummary: 'parent turn',
    });

    const child = await runDriver(root, 'start-and-complete', 'agent-run-2p-child');
    expect(child.pid).not.toBe(process.pid);
    expect(getAgentRun('agent-run-2p-child')).toEqual(expect.objectContaining({
      id: 'agent-run-2p-child',
      status: 'completed',
      outputSummary: 'child done',
    }));
    expect(listAgentEvents({ runId: 'agent-run-2p-child' }).map((event) => event.type)).toEqual([
      'run_completed',
      'text',
      'run_started',
    ]);
    // Rows written by the child carry no record of their own (spec-ledger-write-cost);
    // this process joins it back from the run row, lifecycle rows keep their snapshot.
    const childEvents = listAgentEvents({ runId: 'agent-run-2p-child' });
    expect(childEvents.every((event) => event.record.id === 'agent-run-2p-child')).toBe(true);
    expect(childEvents.find((event) => event.type === 'text')?.record.status).toBe('completed');
    expect(childEvents.find((event) => event.type === 'run_started')?.record.status).toBe('running');
    expect(listAgentRuns().map((run) => run.id)).toEqual(['agent-run-2p-child', parentRun.id]);

    const seenByChild = await runDriver(root, 'get-run', parentRun.id);
    expect(seenByChild.record).toEqual(expect.objectContaining({ id: parentRun.id, status: 'running' }));
    expect(seenByChild.events).toEqual(['run_started']);
    completeAgentRun(parentRun.id, { outputSummary: 'parent done' });
    const afterComplete = await runDriver(root, 'get-run', parentRun.id);
    expect(afterComplete.record).toEqual(expect.objectContaining({ status: 'completed', outputSummary: 'parent done' }));
  }, 60_000);

  it('a run whose owning process exited mid-flight is failed on the next read, row untouched', async () => {
    const result = await runDriver(root, 'start-and-exit', 'agent-run-2p-orphan');
    expect(result.pid).not.toBe(process.pid);

    expect(listAgentRuns({ runId: 'agent-run-2p-orphan' })).toEqual([
      expect.objectContaining({
        id: 'agent-run-2p-orphan',
        status: 'failed',
        error: expect.stringContaining('exited'),
        metadata: expect.objectContaining({ failureReason: 'process-died' }),
      }),
    ]);
    // The dead process's row is evidence, not something we rewrite.
    expect(rawRunStatus('agent-run-2p-orphan')).toBe('running');
    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-2p-orphan', status: 'failed' })).toHaveLength(1);
    expect(listAgentRuns({ runId: 'agent-run-2p-orphan', status: 'running' })).toEqual([]);
  }, 60_000);

  it.skipIf(!bun)('a Bun process and a Node process write the same ledger concurrently and see each other\'s runs', async () => {
    // The published platform binaries run the CLI under Bun (bun:sqlite) while
    // the Web / Desktop runtime stays on Node (node:sqlite); both must share
    // the same WAL file without losing rows or re-applying migrations.
    const COUNT = 60;
    const [viaBun, viaNode] = await Promise.all([
      runDriverWith(bun as string, root, 'append-many', 'bun-proc', String(COUNT)),
      runDriver(root, 'append-many', 'node-proc', String(COUNT)),
    ]);
    expect(viaBun.runtime).toBe('bun');
    expect(viaNode.runtime).toBe('node');
    expect(viaBun.pid).not.toBe(viaNode.pid);

    const runs = listAgentRuns({ kind: 'pi-subagent', limit: 500 });
    expect(runs).toHaveLength(COUNT * 2);
    const runtimeIds = new Set(runs.map((run) => run.runtimeId));
    for (let index = 0; index < COUNT; index += 1) {
      expect(runtimeIds.has(`bun-proc-${index}`)).toBe(true);
      expect(runtimeIds.has(`node-proc-${index}`)).toBe(true);
    }
    expect(runs.every((run) => run.status === 'completed')).toBe(true);

    const parentRun = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'parent-node',
      displayName: 'Parent Run',
      permissionMode: 'ask',
      inputSummary: 'parent turn seen by bun',
    });
    const seenByBun = await runDriverWith(bun as string, root, 'get-run', parentRun.id);
    expect(seenByBun.runtime).toBe('bun');
    expect(seenByBun.record).toEqual(expect.objectContaining({ id: parentRun.id, status: 'running' }));
    expect(seenByBun.events).toEqual(['run_started']);

    const bunChild = await runDriverWith(bun as string, root, 'start-and-complete', 'agent-run-2p-bun-child');
    expect(bunChild.runtime).toBe('bun');
    expect(getAgentRun('agent-run-2p-bun-child')).toEqual(expect.objectContaining({
      id: 'agent-run-2p-bun-child',
      status: 'completed',
      outputSummary: 'child done',
    }));
    expect(rawRunStatus('agent-run-2p-bun-child')).toBe('completed');
  }, 90_000);
});
