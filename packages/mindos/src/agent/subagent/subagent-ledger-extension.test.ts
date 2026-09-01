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
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { finalizeSubagentAsyncRunFromEvent, wrapSubagentToolForLedger } from './subagent-ledger-extension.js';
import { getCurrentAgentRunContext, runWithAgentRunContext, setAgentRunContextForResource } from '../agent-run-context.js';
import {
  listAgentEvents,
  listAgentRuns,
  resetAgentRunsForTest,
  startAgentRun,
} from '../ledger/run-ledger.js';

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
      { cwd: '/tmp/fallback', permissionMode: 'read' },
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
        permissionMode: 'read',
        inputSummary: expect.stringContaining('Review the patch.'),
        outputSummary: 'Review completed.',
        metadata: expect.objectContaining({ toolCallId: 'tool-call-1', source: 'pi-subagents' }),
      }),
    ]);
  });

  it('inherits the parent run permission when the pi tool context has no permissionMode', async () => {
    const mainRun = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      permissionMode: 'read',
      inputSummary: 'Parent read-only run.',
    });
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Read-only child completed.' }],
        details: {},
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await runWithAgentRunContext({
      rootRunId: mainRun.id,
      parentRunId: mainRun.id,
    }, () => wrapped.execute(
      'tool-call-inherit-permission',
      { agent: 'reviewer', task: 'Review without explicit ctx permission.' },
      undefined,
      undefined,
      { cwd: '/tmp/mindos' },
    ));

    expect(listAgentRuns({ kind: 'pi-subagent' })).toEqual([
      expect.objectContaining({
        runtimeId: 'reviewer',
        parentRunId: mainRun.id,
        permissionMode: 'read',
        status: 'completed',
      }),
    ]);
  });

  it('links subagent runs to the request context through the pi session manager when ALS is unavailable', async () => {
    const sessionManager = {};
    const restoreContext = setAgentRunContextForResource(sessionManager, {
      chatSessionId: 'chat-subagent-1',
      rootRunId: 'root-run-1',
      parentRunId: 'main-run-1',
    });
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Listed agents.' }],
        details: {},
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    try {
      await wrapped.execute(
        'tool-call-context',
        { action: 'list' },
        undefined,
        undefined,
        { sessionManager, cwd: '/tmp/mindos' },
      );
    } finally {
      restoreContext();
    }

    expect(listAgentRuns()).toEqual([
      expect.objectContaining({
        agentKind: 'pi-subagent',
        runtimeId: 'subagent:list',
        chatSessionId: 'chat-subagent-1',
        rootRunId: 'root-run-1',
        parentRunId: 'main-run-1',
        status: 'completed',
      }),
    ]);
  });

  it('links MindOS-orchestrated subagent runs to the request context through the pi session manager', async () => {
    const sessionManager = {};
    const restoreContext = setAgentRunContextForResource(sessionManager, {
      chatSessionId: 'chat-orchestration-1',
      rootRunId: 'root-run-orchestration-1',
      parentRunId: 'main-run-orchestration-1',
    });
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Child done.' }],
        details: {},
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    try {
      await wrapped.execute(
        'tool-call-orchestration-context',
        {
          mindosOrchestration: true,
          tasks: [{ id: 'scan', agent: 'scout', task: 'Scan files.' }],
        },
        undefined,
        undefined,
        { sessionManager, cwd: '/tmp/mindos' },
      );
    } finally {
      restoreContext();
    }

    const runs = listAgentRuns({ kind: 'pi-subagent', limit: 10 });
    const parent = runs.find((run) => run.runtimeId === 'subagent:orchestration');
    const child = runs.find((run) => run.runtimeId === 'scout');
    expect(parent).toEqual(expect.objectContaining({
      chatSessionId: 'chat-orchestration-1',
      rootRunId: 'root-run-orchestration-1',
      parentRunId: 'main-run-orchestration-1',
      status: 'completed',
    }));
    expect(child).toEqual(expect.objectContaining({
      chatSessionId: 'chat-orchestration-1',
      rootRunId: 'root-run-orchestration-1',
      parentRunId: parent!.id,
      status: 'completed',
    }));
  });

  it('wraps child subagent execution in the optional host runtime hook', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: process.env.MINDOS_TEST_CHILD_RUNTIME ?? 'missing' }],
        details: {},
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any, {
      withSubagentChildRuntime: vi.fn(async (_input, run) => {
        const previous = process.env.MINDOS_TEST_CHILD_RUNTIME;
        process.env.MINDOS_TEST_CHILD_RUNTIME = 'active';
        try {
          return await run();
        } finally {
          if (previous === undefined) delete process.env.MINDOS_TEST_CHILD_RUNTIME;
          else process.env.MINDOS_TEST_CHILD_RUNTIME = previous;
        }
      }),
    });

    const result = await wrapped.execute(
      'tool-call-child-runtime',
      { agent: 'delegate', task: 'Use child runtime.' },
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'active' }],
      details: {},
    });
    expect(process.env.MINDOS_TEST_CHILD_RUNTIME).toBeUndefined();
  });

  it('does not apply the child runtime hook for management actions', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Executable agents: delegate' }],
        details: {},
      })),
    };
    const hook = vi.fn(async (_input, run) => run());
    const wrapped = wrapSubagentToolForLedger(upstream as any, {
      withSubagentChildRuntime: hook,
    });

    await wrapped.execute('tool-call-list', { action: 'list' });

    expect(hook).not.toHaveBeenCalled();
    expect(upstream.execute).toHaveBeenCalledTimes(1);
  });

  it('translates legacy parallel tasks into a pi-subagents workflow script', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Parallel review completed.' }],
        details: {},
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-legacy-parallel', {
      tasks: [
        { id: 'scan', agent: 'scout', task: 'Scan files.' },
        { id: 'review', agent: 'reviewer', task: 'Review files.', model: 'openai/gpt-5.6' },
      ],
      concurrency: 2,
      async: false,
      cwd: '/tmp/mindos',
    });

    expect(upstream.execute).toHaveBeenCalledWith(
      'tool-call-legacy-parallel',
      expect.objectContaining({
        workflowScript: expect.stringContaining('return runs.all('),
        globalConcurrencyLimit: 2,
        async: false,
        cwd: '/tmp/mindos',
      }),
      expect.any(AbortSignal),
      expect.any(Function),
      undefined,
    );
    const forwarded = upstream.execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('tasks');
    expect(forwarded).not.toHaveProperty('concurrency');
    expect(forwarded.workflowScript).toContain('"key":"scan"');
    expect(forwarded.workflowScript).toContain('"agent":"reviewer"');
    expect(forwarded.workflowScript).toContain('"model":"openai/gpt-5.6"');
  });

  it('preserves legacy foreground and concurrency defaults when they are omitted', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Done.' }], details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-legacy-defaults', {
      tasks: [{ agent: 'reviewer', task: 'Review.' }],
      clarify: false,
    });

    const forwarded = upstream.execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(forwarded).toEqual(expect.objectContaining({
      async: false,
      globalConcurrencyLimit: 4,
      workflowScript: expect.stringContaining('return runs.all('),
    }));
    expect(forwarded).not.toHaveProperty('clarify');
  });

  it('does not silently discard a legacy clarify UI request', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Unsupported.' }], isError: true, details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);
    const params = {
      tasks: [{ agent: 'reviewer', task: 'Review.' }],
      clarify: true,
    };

    await wrapped.execute('tool-call-legacy-clarify', params);

    expect(upstream.execute.mock.calls[0]![1]).toBe(params);
  });

  it('creates bounded unique workflow keys for repeated legacy tasks', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Done.' }], details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-repeated', {
      tasks: [{ id: ' repeated key! ', agent: 'reviewer', task: 'Review.', count: 2 }],
    });

    const forwarded = upstream.execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(forwarded.workflowScript).toContain('"key":"repeated-key"');
    expect(forwarded.workflowScript).toContain('"key":"repeated-key-2"');
    expect(forwarded.workflowScript).not.toContain('"count"');
  });

  it('does not let legacy child keys override sanitized unique workflow keys', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Done.' }], details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-child-keys', {
      tasks: [
        { id: 'safe', key: 'bad key!', agent: 'reviewer', task: 'Review one.' },
        { id: 'safe', key: 'bad key!', agent: 'reviewer', task: 'Review two.' },
      ],
    });

    const forwarded = upstream.execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(forwarded.workflowScript).toContain('"key":"safe"');
    expect(forwarded.workflowScript).toContain('"key":"safe-2"');
    expect(forwarded.workflowScript).not.toContain('bad key!');
  });

  it('leaves invalid legacy fanout counts untouched for upstream validation', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Invalid.' }], isError: true, details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);
    const params = { tasks: [{ agent: 'reviewer', task: 'Review.', count: 1.5 }] };

    await wrapped.execute('tool-call-invalid-count', params);

    expect(upstream.execute.mock.calls[0]![1]).toBe(params);
  });

  it.each([0, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'leaves invalid legacy concurrency %s untouched for upstream validation',
    async (concurrency) => {
      const upstream = {
        name: 'subagent',
        parameters: {} as any,
        execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Invalid.' }], isError: true, details: {} })),
      };
      const wrapped = wrapSubagentToolForLedger(upstream as any);
      const params = { tasks: [{ agent: 'reviewer', task: 'Review.' }], concurrency };

      await wrapped.execute('tool-call-invalid-concurrency', params);

      expect(upstream.execute.mock.calls[0]![1]).toBe(params);
    },
  );

  it('bounds aggregate legacy workflow fanout at 64 children', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Done.' }], details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);
    const accepted = {
      tasks: Array.from({ length: 64 }, (_, index) => ({
        id: `task-${index + 1}`,
        agent: 'reviewer',
        task: `Review ${index + 1}.`,
      })),
    };
    const rejected = {
      tasks: [
        { id: 'first', agent: 'reviewer', task: 'Review first.', count: 32 },
        { id: 'second', agent: 'reviewer', task: 'Review second.', count: 33 },
      ],
    };

    await wrapped.execute('tool-call-max-fanout', accepted);
    await wrapped.execute('tool-call-over-fanout', rejected);

    expect(upstream.execute.mock.calls[0]![1]).not.toBe(accepted);
    expect((upstream.execute.mock.calls[0]![1] as Record<string, unknown>).workflowScript).toContain('return runs.all(');
    expect(upstream.execute.mock.calls[1]![1]).toBe(rejected);
  });

  it('translates a legacy chain into sequential workflowScript runs', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({
        content: [{ type: 'text', text: 'Chain completed.' }],
        details: {},
      })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-legacy-chain', {
      chain: [
        { agent: 'scout', task: 'Draft a plan.' },
        { agent: 'reviewer', task: 'Review {previous}' },
      ],
      async: false,
    });

    const forwarded = upstream.execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('chain');
    expect(forwarded.workflowScript).toContain('await runs.run("step-1"');
    expect(forwarded.workflowScript).toContain('await runs.run("step-2"');
    expect(forwarded.workflowScript).toContain('.replaceAll("{previous}", previous)');
    expect(forwarded.workflowScript).toContain('return step2;');
  });

  it('passes current workflowScript requests through unchanged', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Done.' }], details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);
    const params = {
      workflowScript: 'return runs.run("review", { agent: "reviewer", task: "Review." });',
      async: false,
    };

    await wrapped.execute('tool-call-workflow', params);

    expect(upstream.execute.mock.calls[0]![1]).toBe(params);
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

  it('strips orchestration-only fields before calling direct child subagents', async () => {
    const upstream = {
      name: 'subagent',
      parameters: {} as any,
      execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Done.' }], details: {} })),
    };
    const wrapped = wrapSubagentToolForLedger(upstream as any);

    await wrapped.execute('tool-call-orchestrated-fields', {
      mindosOrchestration: true,
      concurrency: 3,
      parallel: true,
      chainDir: '/tmp/chain',
      globalConcurrencyLimit: 7,
      maxSubagentSpawnsPerRun: 9,
      workflowScriptPath: '/tmp/workflow.js',
      clarify: false,
      tasks: [{ id: 'scan', agent: 'scout', task: 'Scan files.' }],
    });

    const forwarded = upstream.execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(forwarded).toEqual(expect.objectContaining({
      agent: 'scout',
      task: 'Scan files.',
      async: false,
    }));
    for (const field of [
      'tasks',
      'subtasks',
      'chain',
      'mindosOrchestration',
      'orchestrator',
      'concurrency',
      'parallel',
      'chainDir',
      'globalConcurrencyLimit',
      'maxSubagentSpawnsPerRun',
      'workflowScriptPath',
      'clarify',
    ]) {
      expect(forwarded).not.toHaveProperty(field);
    }
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
