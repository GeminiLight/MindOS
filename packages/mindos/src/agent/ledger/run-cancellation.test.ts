/**
 * Behavior tests for the run cancellation bridge. Migrated from
 * packages/web/__tests__/agent/run-cancellation.test.ts
 * (spec-agent-core-consolidation Wave 2).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  cancelAgentRunWithHandlers,
  linkAbortSignalToAgentRun,
  registerAgentRunCancelHandler,
  resetAgentRunCancellationForTest,
} from './run-cancellation.js';
import {
  listAgentEvents,
  resetAgentRunsForTest,
  startAgentRun,
} from './run-ledger.js';

describe('agent run cancellation bridge', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-run-cancellation-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
    resetAgentRunCancellationForTest();
  });

  afterEach(() => {
    resetAgentRunsForTest();
    resetAgentRunCancellationForTest();
    setMindRootResolverForTests(null);
    rmSync(root, { recursive: true, force: true });
  });

  it('marks the run canceled and invokes registered adapter handlers', async () => {
    const handler = vi.fn();
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini',
      permissionMode: 'agent',
      inputSummary: 'Work on this.',
    });
    registerAgentRunCancelHandler(run.id, handler);

    await cancelAgentRunWithHandlers(run.id, {
      reason: 'User stopped the run.',
      metadata: { canceledBy: 'test' },
    });

    expect(handler).toHaveBeenCalledWith({
      reason: 'User stopped the run.',
      metadata: { canceledBy: 'test' },
    });
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_canceled',
      'run_started',
    ]);
  });

  it('links a request AbortSignal to run cancellation exactly once', async () => {
    const controller = new AbortController();
    const handler = vi.fn();
    const run = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      permissionMode: 'readonly',
      inputSummary: 'Review this.',
    });
    registerAgentRunCancelHandler(run.id, handler);
    const unlink = linkAbortSignalToAgentRun(run.id, controller.signal, {
      reason: 'Subagent run was canceled.',
      metadata: { aborted: true },
    });

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    unlink();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(listAgentEvents({ runId: run.id, type: 'run_canceled' })).toHaveLength(1);
  });
});
