/**
 * Behavior tests for the subagent ledger extension core (the ledger tool
 * wrapper and async-completion finalization). Migrated from
 * packages/web/__tests__/agent/subagent-ledger-extension.test.ts
 * (spec-agent-core-consolidation Wave 4). The web entry keeps the
 * host-specific jiti loading of the upstream pi-subagents extension; that
 * path is exercised by the web pi-subagents integration tests.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMindRootResolverForTests } from '../foundation/mind-root/index.js';
import { finalizeSubagentAsyncRunFromEvent, wrapSubagentToolForLedger } from './subagent-ledger-extension.js';
import { getCurrentAgentRunContext } from './agent-run-context.js';
import {
  listAgentEvents,
  listAgentRuns,
  resetAgentRunsForTest,
} from './run-ledger.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('MindOS subagent ledger extension', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-subagent-ledger-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
  });

  afterEach(() => {
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    rmSync(root, { recursive: true, force: true });
  });

  it('records successful subagent tool calls without modifying upstream behavior', async () => {
    let capturedParentRunId: string | undefined;
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => {
        capturedParentRunId = getCurrentAgentRunContext()?.parentRunId;
        return {
          content: [{ type: 'text', text: 'Review completed.' }],
          details: {},
        };
      }),
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
    const runs = listAgentRuns();
    expect(capturedParentRunId).toBe(runs[0]?.id);
    expect(runs).toEqual([
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

  it('forwards single subagent progress updates into the run timeline without swallowing upstream onUpdate', async () => {
    const forwardedUpdates: unknown[] = [];
    const progressUpdate = {
      content: [{ type: 'text', text: 'Step 1: scanning files.' }],
      details: { runId: 'upstream-progress-1' },
    };
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async (_toolCallId: string, _params: unknown, _signal?: AbortSignal, onUpdate?: unknown) => {
        if (typeof onUpdate === 'function') onUpdate(progressUpdate);
        return {
          content: [{ type: 'text', text: 'Review completed.' }],
          details: {},
        };
      }),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute(
      'tool-call-progress',
      { agent: 'reviewer', task: 'Review the patch.' },
      undefined,
      (update: unknown) => forwardedUpdates.push(update),
    );

    const [run] = listAgentRuns();
    expect(forwardedUpdates).toEqual([progressUpdate]);
    expect(listAgentEvents({ runId: run!.id, category: 'text' })).toEqual([
      expect.objectContaining({
        type: 'text',
        title: 'Subagent update',
        message: 'Step 1: scanning files.',
        metadata: expect.objectContaining({ upstreamRunId: 'upstream-progress-1' }),
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

  it('routes explicit MindOS orchestration through child ledger runs', async () => {
    const scout = deferred<any>();
    const reviewer = deferred<any>();
    const startedAgents: string[] = [];
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async (_toolCallId: string, params: unknown) => {
        const agent = (params as { agent?: string }).agent;
        startedAgents.push(agent ?? '');
        return agent === 'scout' ? scout.promise : reviewer.promise;
      }),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    const resultPromise = wrapped.execute('tool-call-orchestrated', {
      mindosOrchestration: true,
      tasks: [
        { id: 'scan', agent: 'scout', task: 'Scan files.' },
        { id: 'review', agent: 'reviewer', task: 'Review findings.' },
      ],
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(startedAgents).toEqual(['scout', 'reviewer']);

    scout.resolve({ content: [{ type: 'text', text: 'Scan done.' }], details: {} });
    reviewer.resolve({ content: [{ type: 'text', text: 'Review done.' }], details: {} });
    const result = await resultPromise;

    expect(result).toEqual(expect.objectContaining({
      isError: false,
      details: expect.objectContaining({
        mode: 'mindos-orchestration',
        status: 'completed',
      }),
    }));
    expect(upstream.execute).toHaveBeenCalledTimes(2);

    const runs = listAgentRuns({ kind: 'pi-subagent', limit: 10 });
    const parent = runs.find((run) => run.runtimeId === 'subagent:orchestration');
    expect(parent).toEqual(expect.objectContaining({
      status: 'completed',
      outputSummary: expect.stringContaining('2 completed'),
    }));
    expect(listAgentRuns({ parentRunId: parent!.id }).map((run) => `${run.runtimeId}:${run.status}`).sort()).toEqual([
      'reviewer:completed',
      'scout:completed',
    ]);
  });

  it('records orchestration child progress on the matching child run', async () => {
    const forwardedUpdates: unknown[] = [];
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async (_toolCallId: string, params: unknown, _signal?: AbortSignal, onUpdate?: unknown) => {
        const agent = (params as { agent?: string }).agent ?? 'unknown';
        const update = {
          content: [{ type: 'text', text: `${agent} progress` }],
          details: { runId: `upstream-${agent}` },
        };
        if (typeof onUpdate === 'function') onUpdate(update);
        return {
          content: [{ type: 'text', text: `${agent} done` }],
          details: {},
        };
      }),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute(
      'tool-call-orchestrated-progress',
      {
        mindosOrchestration: true,
        tasks: [
          { id: 'scan', agent: 'scout', task: 'Scan files.' },
          { id: 'review', agent: 'reviewer', task: 'Review findings.' },
        ],
      },
      undefined,
      (update: unknown) => forwardedUpdates.push(update),
    );

    const parent = listAgentRuns({ kind: 'pi-subagent', limit: 10 })
      .find((run) => run.runtimeId === 'subagent:orchestration');
    const children = listAgentRuns({ parentRunId: parent!.id, limit: 10 });
    const scout = children.find((run) => run.runtimeId === 'scout');
    const reviewer = children.find((run) => run.runtimeId === 'reviewer');

    expect(forwardedUpdates).toHaveLength(2);
    expect(listAgentEvents({ runId: parent!.id, category: 'text' })).toEqual([]);
    expect(listAgentEvents({ runId: scout!.id, category: 'text' })).toEqual([
      expect.objectContaining({
        message: 'scout progress',
        metadata: expect.objectContaining({ upstreamRunId: 'upstream-scout' }),
      }),
    ]);
    expect(listAgentEvents({ runId: reviewer!.id, category: 'text' })).toEqual([
      expect.objectContaining({
        message: 'reviewer progress',
        metadata: expect.objectContaining({ upstreamRunId: 'upstream-reviewer' }),
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
    expect(listAgentEvents({ type: 'run_canceled' })).toHaveLength(1);
  });

  it('finalizes a detached run whose completion event arrived before the run was marked streaming', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => {
        // The async work completed so fast that its completion event fires
        // before the ledger wrapper has stored the asyncId on the run.
        expect(finalizeSubagentAsyncRunFromEvent({
          id: 'async-early',
          state: 'completed',
          summary: 'Fast async result.',
        })).toBe(false);
        return {
          content: [{ type: 'text', text: 'Async run started.' }],
          details: { asyncId: 'async-early', mode: 'async' },
        };
      }),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-early', { agent: 'worker', task: 'Fast async task.' });

    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        status: 'completed',
        outputSummary: 'Fast async result.',
      }),
    ]);
  });
});
