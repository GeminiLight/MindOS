import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeSubagentAsyncRunFromEvent, wrapSubagentToolForLedger } from '@/lib/agent/subagent-ledger-extension';
import {
  listAgentRuns,
  resetAgentRunsForTest,
} from '@/lib/agent/run-ledger';

describe('MindOS subagent ledger extension', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('records successful subagent tool calls without modifying upstream behavior', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Review completed.' }],
        details: {},
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    const result = await wrapped.execute(
      'tool-call-1',
      { agent: 'reviewer', task: 'Review the patch.', cwd: '/tmp/mindos' },
      undefined,
      undefined,
      { cwd: '/tmp/fallback', mode: 'chat' },
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Review completed.' }],
      details: {},
    });
    expect(upstream.execute).toHaveBeenCalledTimes(1);
    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        runtimeId: 'reviewer',
        displayName: 'reviewer',
        status: 'completed',
        cwd: '/tmp/mindos',
        permissionMode: 'readonly',
        inputSummary: expect.stringContaining('Review the patch.'),
        outputSummary: 'Review completed.',
        metadata: expect.objectContaining({ toolCallId: 'tool-call-1', source: 'pi-subagents' }),
      }),
    ]);
  });

  it('records failed subagent tool calls and rethrows the upstream error', async () => {
    const upstreamError = new Error('child failed');
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => {
        throw upstreamError;
      }),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await expect(wrapped.execute('tool-call-2', { tasks: [{ agent: 'tester', task: 'Run tests.' }] }))
      .rejects.toThrow('child failed');

    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        runtimeId: 'subagent:parallel',
        displayName: 'Parallel subagents (1)',
        status: 'failed',
        error: 'child failed',
      }),
    ]);
  });

  it('keeps detached async subagent runs open instead of marking them completed', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Async: reviewer [async-1]\n\nThe async run is detached.' }],
        details: {
          mode: 'single',
          runId: 'async-1',
          asyncId: 'async-1',
          asyncDir: '/tmp/pi-subagents/async-1',
          results: [],
        },
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-async', { agent: 'reviewer', task: 'Review later.', async: true });

    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        runtimeId: 'reviewer',
        status: 'streaming',
        outputSummary: expect.stringContaining('The async run is detached.'),
        metadata: expect.objectContaining({
          upstreamRunId: 'async-1',
          asyncId: 'async-1',
          asyncDir: '/tmp/pi-subagents/async-1',
          detached: true,
        }),
      }),
    ]);
  });

  it('finalizes detached async subagent runs from upstream completion events', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Async: reviewer [async-2]\n\nThe async run is detached.' }],
        details: {
          mode: 'single',
          runId: 'async-2',
          asyncId: 'async-2',
          asyncDir: '/tmp/pi-subagents/async-2',
          results: [],
        },
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-async-2', { agent: 'reviewer', task: 'Review later.', async: true });

    expect(finalizeSubagentAsyncRunFromEvent({
      id: 'async-2',
      runId: 'async-2',
      results: [{ agent: 'reviewer', status: 'completed', summary: 'Async review completed.' }],
    })).toBe(true);

    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        runtimeId: 'reviewer',
        status: 'completed',
        outputSummary: 'Async review completed.',
        metadata: expect.objectContaining({
          asyncId: 'async-2',
          asyncComplete: true,
        }),
      }),
    ]);
  });

  it('marks detached async subagent failures from upstream completion events', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Async: tester [async-failed]\n\nThe async run is detached.' }],
        details: {
          mode: 'single',
          runId: 'async-failed',
          asyncId: 'async-failed',
          asyncDir: '/tmp/pi-subagents/async-failed',
          results: [],
        },
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-async-failed', { agent: 'tester', task: 'Fail later.', async: true });
    expect(finalizeSubagentAsyncRunFromEvent({
      id: 'async-failed',
      results: [{ agent: 'tester', status: 'failed', summary: 'Tests failed.' }],
    })).toBe(true);

    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        runtimeId: 'tester',
        status: 'failed',
        error: 'Tests failed.',
      }),
    ]);
  });

  it('keeps canceled status when a signal aborts before upstream settles', async () => {
    const controller = new AbortController();
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => {
        controller.abort();
        return { content: [{ type: 'text', text: 'late result' }], details: {} };
      }),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-3', { agent: 'worker', task: 'Stop soon.' }, controller.signal);

    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        runtimeId: 'worker',
        status: 'canceled',
        error: 'Subagent run was canceled.',
      }),
    ]);
  });
});
