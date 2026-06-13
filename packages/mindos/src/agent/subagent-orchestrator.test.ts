/**
 * Behavior tests for the subagent orchestrator. Migrated from
 * packages/web/__tests__/agent/subagent-orchestrator.test.ts
 * (spec-agent-core-consolidation Wave 4).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMindRootResolverForTests } from '../foundation/mind-root/index.js';
import { executeSubagentOrchestrationPlan, type SubagentTaskExecutorResult } from './subagent-orchestrator.js';
import { listAgentRuns, resetAgentRunsForTest } from './run-ledger.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('subagent orchestrator', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-subagent-orchestrator-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
  });

  afterEach(() => {
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    rmSync(root, { recursive: true, force: true });
  });

  it('runs independent subagent tasks in parallel and records child runs', async () => {
    const first = deferred<SubagentTaskExecutorResult>();
    const second = deferred<SubagentTaskExecutorResult>();
    const started: string[] = [];

    const resultPromise = executeSubagentOrchestrationPlan({
      id: 'orchestration-parallel',
      tasks: [
        { id: 'scan', agent: 'scout', task: 'Scan code.' },
        { id: 'review', agent: 'reviewer', task: 'Review code.' },
      ],
    }, (task) => {
      started.push(task.id);
      return task.id === 'scan' ? first.promise : second.promise;
    });

    await flushMicrotasks();
    expect(started).toEqual(['scan', 'review']);
    expect(listAgentRuns({ parentRunId: 'orchestration-parallel' }).map((run) => run.status).sort()).toEqual(['running', 'running']);

    first.resolve({ outputSummary: 'Scan done.' });
    second.resolve({ outputSummary: 'Review done.' });

    const result = await resultPromise;
    expect(result).toMatchObject({
      status: 'completed',
      reduction: {
        completed: 2,
        failed: 0,
        canceled: 0,
        timedOut: 0,
      },
    });
    expect(result.tasks.map((task) => `${task.taskId}:${task.status}`)).toEqual([
      'scan:completed',
      'review:completed',
    ]);
    expect(listAgentRuns({ parentRunId: 'orchestration-parallel' }).map((run) => `${run.runtimeId}:${run.status}`)).toEqual([
      'reviewer:completed',
      'scout:completed',
    ]);
  });

  it('waits for dependencies before launching dependent tasks', async () => {
    const prepare = deferred<SubagentTaskExecutorResult>();
    const started: string[] = [];

    const resultPromise = executeSubagentOrchestrationPlan({
      id: 'orchestration-deps',
      tasks: [
        { id: 'prepare', agent: 'planner', task: 'Prepare context.' },
        { id: 'implement', agent: 'worker', task: 'Use prepared context.', dependencies: ['prepare'] },
      ],
    }, (task, context) => {
      started.push(task.id);
      if (task.id === 'prepare') return prepare.promise;
      expect(context.dependencyResults.get('prepare')?.status).toBe('completed');
      return { outputSummary: 'Implementation done.' };
    });

    await flushMicrotasks();
    expect(started).toEqual(['prepare']);

    prepare.resolve({ outputSummary: 'Context ready.' });

    const result = await resultPromise;
    expect(started).toEqual(['prepare', 'implement']);
    expect(result.tasks.map((task) => `${task.taskId}:${task.status}`)).toEqual([
      'prepare:completed',
      'implement:completed',
    ]);
  });

  it('does not let a failed branch block unrelated independent work', async () => {
    const independent = deferred<SubagentTaskExecutorResult>();
    const started: string[] = [];

    const resultPromise = executeSubagentOrchestrationPlan({
      id: 'orchestration-failure-isolation',
      tasks: [
        { id: 'risky', agent: 'tester', task: 'Run risky tests.' },
        { id: 'independent', agent: 'reviewer', task: 'Review docs.' },
        { id: 'after-risky', agent: 'worker', task: 'Continue risky branch.', dependencies: ['risky'] },
      ],
    }, (task) => {
      started.push(task.id);
      if (task.id === 'risky') throw new Error('risky branch failed');
      if (task.id === 'independent') return independent.promise;
      return { outputSummary: 'should not run' };
    });

    await flushMicrotasks();
    expect(started).toEqual(['risky', 'independent']);

    independent.resolve({ outputSummary: 'Independent work completed.' });
    const result = await resultPromise;

    expect(started).toEqual(['risky', 'independent']);
    expect(result).toMatchObject({
      status: 'failed',
      reduction: {
        completed: 1,
        failed: 1,
        canceled: 1,
        timedOut: 0,
      },
    });
    expect(result.tasks.map((task) => `${task.taskId}:${task.status}`)).toEqual([
      'risky:failed',
      'independent:completed',
      'after-risky:canceled',
    ]);
    expect(listAgentRuns({ parentRunId: 'orchestration-failure-isolation' }).map((run) => `${run.runtimeId}:${run.status}`)).toEqual([
      'worker:canceled',
      'reviewer:completed',
      'tester:failed',
    ]);
  });

  it('marks a timed-out subtask as timed_out and summarizes it in the reducer', async () => {
    const result = await executeSubagentOrchestrationPlan({
      id: 'orchestration-timeout',
      timeoutMs: 5,
      tasks: [
        { id: 'slow', agent: 'slow-agent', task: 'Never finish.' },
      ],
    }, () => new Promise(() => {}));

    expect(result).toMatchObject({
      status: 'timed_out',
      reduction: {
        completed: 0,
        failed: 0,
        canceled: 0,
        timedOut: 1,
      },
    });
    expect(result.tasks).toEqual([
      expect.objectContaining({
        taskId: 'slow',
        status: 'timed_out',
        error: 'Subagent task slow timed out after 5ms.',
      }),
    ]);
    expect(listAgentRuns({ parentRunId: 'orchestration-timeout' })).toEqual([
      expect.objectContaining({
        runtimeId: 'slow-agent',
        status: 'timed_out',
        error: 'Subagent task slow timed out after 5ms.',
      }),
    ]);
  });

  it('fails the task and finalizes the parent when result normalization itself throws', async () => {
    // An executor result whose property access explodes throws inside
    // executeOneTask *after* the child run was started — outside the
    // runWithTimeout failure handling.
    const poisoned = {} as SubagentTaskExecutorResult;
    Object.defineProperty(poisoned, 'status', {
      enumerable: true,
      get() { throw new Error('poisoned result'); },
    });

    const result = await executeSubagentOrchestrationPlan({
      id: 'orchestration-poisoned',
      tasks: [
        { id: 'bad', agent: 'bad-agent', task: 'Return a poisoned result.' },
      ],
    }, () => poisoned);

    expect(result).toMatchObject({
      status: 'failed',
      reduction: { completed: 0, failed: 1, canceled: 0, timedOut: 0 },
    });
    expect(result.tasks).toEqual([
      expect.objectContaining({ taskId: 'bad', status: 'failed', error: 'poisoned result' }),
    ]);
    // The parent run must reach a terminal state — never stuck 'running'.
    expect(listAgentRuns({ parentRunId: 'orchestration-poisoned' })).toEqual([
      expect.objectContaining({ runtimeId: 'bad-agent', status: 'failed' }),
    ]);
    const parent = listAgentRuns().find((run) => run.id === 'orchestration-poisoned');
    expect(parent?.status).toBe('failed');
  });
});
