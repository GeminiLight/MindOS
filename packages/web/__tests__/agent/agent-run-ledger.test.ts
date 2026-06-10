import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getTestMindRoot } from '../setup';
import {
  completeAgentRun,
  failAgentRun,
  getAgentRun,
  listAgentEvents,
  listAgentRuns,
  reloadAgentRunsFromDiskForTest,
  resetAgentRunsForTest,
  startAgentRun,
  updateAgentRun,
} from '@/lib/agent/run-ledger';
import { runWithAgentRunContext } from '@/lib/agent/agent-run-context';

describe('agent run ledger', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a complete delegation run with duration and query filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const run = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      cwd: '/tmp/project',
      permissionMode: 'readonly',
      inputSummary: 'Review the patch.',
    });

    expect(run.status).toBe('running');
    expect(run.startedAt).toBe(1000);

    vi.setSystemTime(1250);
    const completed = completeAgentRun(run.id, { outputSummary: 'No blocking issues.' });
    expect(completed).toMatchObject({
      id: run.id,
      status: 'completed',
      outputSummary: 'No blocking issues.',
      completedAt: 1250,
      durationMs: 250,
    });

    expect(listAgentRuns({ kind: 'pi-subagent' })).toHaveLength(1);
    expect(listAgentRuns({ status: 'completed' })).toHaveLength(1);
    expect(listAgentRuns({ kind: 'acp' })).toHaveLength(0);
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_completed',
      'run_started',
    ]);
  });

  it('records failed runs and keeps terminal state stable', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini',
      permissionMode: 'agent',
      inputSummary: 'Research this topic.',
    });

    const failed = failAgentRun(run.id, { error: new Error('spawn failed') });
    expect(failed).toMatchObject({
      status: 'failed',
      error: 'spawn failed',
    });

    completeAgentRun(run.id, { outputSummary: 'late success' });
    expect(getAgentRun(run.id)).toMatchObject({
      status: 'failed',
      error: 'spawn failed',
    });
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_failed',
      'run_started',
    ]);
  });

  it('updates runtime metadata after a placeholder run starts', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'missing-agent',
      displayName: 'missing-agent',
      permissionMode: 'agent',
      inputSummary: 'hello',
    });

    updateAgentRun(run.id, {
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      metadata: { sessionId: 'session-1' },
    });

    expect(getAgentRun(run.id)).toMatchObject({
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      metadata: { sessionId: 'session-1' },
    });
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_updated',
      'run_started',
    ]);
  });

  it('inherits root, chat session, and parent run context when explicit fields are absent', () => {
    const root = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      chatSessionId: 'chat-1',
      permissionMode: 'agent',
      inputSummary: 'Root turn',
    });
    const run = runWithAgentRunContext({ chatSessionId: 'chat-1', rootRunId: root.id, parentRunId: root.id }, () => startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      permissionMode: 'readonly',
      inputSummary: 'Review this patch.',
    }));

    expect(run).toMatchObject({
      rootRunId: root.id,
      chatSessionId: 'chat-1',
      parentRunId: root.id,
    });
    expect(root.rootRunId).toBe(root.id);
    expect(listAgentRuns({ rootRunId: root.id }).map((record) => record.id)).toEqual([
      run.id,
      root.id,
    ]);
    expect(listAgentRuns({ chatSessionId: 'chat-1' })).toEqual([
      expect.objectContaining({ id: run.id }),
      expect.objectContaining({ id: root.id }),
    ]);
    expect(listAgentEvents({ rootRunId: root.id }).map((event) => event.runId)).toEqual([
      run.id,
      root.id,
    ]);
  });

  it('persists records and events under the local mind root ledger file', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      permissionMode: 'agent',
      inputSummary: 'persist this run',
    });
    completeAgentRun(run.id, { outputSummary: 'persisted output' });

    const ledgerPath = path.join(getTestMindRoot(), '.mindos', 'agent-run-ledger.json');
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    expect(raw.records).toEqual([
      expect.objectContaining({
        id: run.id,
        status: 'completed',
        outputSummary: 'persisted output',
      }),
    ]);

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: run.id })).toEqual([
      expect.objectContaining({
        id: run.id,
        status: 'completed',
        outputSummary: 'persisted output',
      }),
    ]);
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_completed',
      'run_started',
    ]);
  });
});
