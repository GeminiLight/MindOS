import { describe, expect, it } from 'vitest';
import { formatAgentResultReduction, reduceAgentRunResults } from '@/lib/agent/result-reducer';

describe('agent result reducer', () => {
  it('summarizes completed, failed, canceled, and timed out runs separately', () => {
    const reduction = reduceAgentRunResults([
      {
        id: 'run-completed',
        runtimeId: 'reviewer',
        displayName: 'Reviewer',
        status: 'completed',
        outputSummary: 'Looks good.',
      },
      {
        id: 'run-failed',
        runtimeId: 'tester',
        displayName: 'Tester',
        status: 'failed',
        error: 'Tests failed.',
      },
      {
        id: 'run-canceled',
        runtimeId: 'writer',
        displayName: 'Writer',
        status: 'canceled',
        error: 'Dependency did not complete.',
      },
      {
        id: 'run-timeout',
        runtimeId: 'researcher',
        displayName: 'Researcher',
        status: 'timed_out',
        error: 'Timed out.',
      },
    ]);

    expect(reduction).toMatchObject({
      total: 4,
      completed: 1,
      failed: 1,
      canceled: 1,
      timedOut: 1,
      pending: 0,
      finalStatus: 'failed',
    });
    expect(reduction.completedRuns.map((item) => item.id)).toEqual(['run-completed']);
    expect(reduction.failedRuns.map((item) => item.id)).toEqual(['run-failed']);
    expect(reduction.canceledRuns.map((item) => item.id)).toEqual(['run-canceled']);
    expect(reduction.timedOutRuns.map((item) => item.id)).toEqual(['run-timeout']);
  });

  it('formats a compact synthesis input for the main agent', () => {
    const reduction = reduceAgentRunResults([
      {
        id: 'run-1',
        runtimeId: 'scout',
        displayName: 'Scout',
        status: 'completed',
        outputSummary: 'Found the relevant files.',
      },
      {
        id: 'run-2',
        runtimeId: 'worker',
        displayName: 'Worker',
        status: 'timed_out',
        error: 'Subagent task worker timed out after 1000ms.',
      },
    ]);

    expect(formatAgentResultReduction(reduction)).toBe([
      'Agent runs: 1 completed, 0 failed, 0 canceled, 1 timed out.',
      'Completed:',
      '- Scout: Found the relevant files.',
      'Issues:',
      '- Worker (timed_out): Subagent task worker timed out after 1000ms.',
    ].join('\n'));
  });
});
