import { beforeEach, describe, expect, it } from 'vitest';
import { executeSubagentOrchestrationPlan, type SubagentTaskExecutorResult } from '@/lib/agent/subagent-orchestrator';
import {
  listAgentRuns,
  resetAgentRunsForTest,
} from '@/lib/agent/run-ledger';

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
  beforeEach(() => {
    resetAgentRunsForTest();
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
});
