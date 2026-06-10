import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getTestMindRoot } from '../setup';
import {
  appendAgentRunEvent,
  cancelAgentRun,
  completeAgentRun,
  failAgentRun,
  getAgentRun,
  listAgentEvents,
  listAgentRuns,
  reloadAgentRunsFromDiskForTest,
  resetAgentRunsForTest,
  startAgentRun,
  subscribeAgentRunEvents,
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

  it('records canceled runs as first-class canceled events', () => {
    const run = startAgentRun({
      agentKind: 'a2a',
      runtimeId: 'remote-agent',
      displayName: 'Remote Agent',
      permissionMode: 'agent',
      inputSummary: 'Delegate this task.',
    });

    const canceled = cancelAgentRun(run.id, {
      reason: 'User stopped the run.',
      metadata: { aborted: true },
    });

    expect(canceled).toMatchObject({
      status: 'canceled',
      error: 'User stopped the run.',
      metadata: { aborted: true },
    });
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_canceled',
      'run_started',
    ]);
    expect(listAgentEvents({ runId: run.id, type: 'run_canceled' })).toEqual([
      expect.objectContaining({
        status: 'canceled',
        message: 'User stopped the run.',
      }),
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

  it('notifies realtime subscribers without letting observer failures affect the ledger', () => {
    const observed: string[] = [];
    const unsubscribeThrowing = subscribeAgentRunEvents(() => {
      throw new Error('observer failed');
    });
    const unsubscribe = subscribeAgentRunEvents((event) => {
      observed.push(`${event.type}:${event.status}`);
    });

    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'agent',
      inputSummary: 'Use Codex',
    });
    completeAgentRun(run.id, { outputSummary: 'Done.' });

    unsubscribeThrowing();
    unsubscribe();

    expect(observed).toEqual([
      'run_started:running',
      'run_completed:completed',
    ]);
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_completed',
      'run_started',
    ]);
  });

  it('records fine-grained timeline events with typed data and category filters', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      chatSessionId: 'chat-events',
      permissionMode: 'agent',
      inputSummary: 'Use Claude',
    });

    appendAgentRunEvent(run.id, {
      type: 'text',
      category: 'text',
      data: { kind: 'text', channel: 'assistant', text: 'I will inspect the files.' },
    });
    appendAgentRunEvent(run.id, {
      type: 'tool_started',
      category: 'tool',
      message: 'Reading package metadata',
      data: { kind: 'tool', name: 'Read', status: 'started', inputSummary: 'package.json' },
    });
    appendAgentRunEvent(run.id, {
      type: 'file_changed',
      category: 'file',
      data: { kind: 'file', action: 'updated', path: 'wiki/specs/runtime.md', summary: 'Updated runtime spec' },
    });
    appendAgentRunEvent(run.id, {
      type: 'permission_requested',
      category: 'permission',
      data: { kind: 'permission', action: 'Bash', status: 'requested', resource: 'rm note.md', prompt: 'Allow delete?' },
    });
    appendAgentRunEvent(run.id, {
      type: 'error',
      category: 'error',
      data: { kind: 'error', message: 'Authorization: Bearer sk-ledger-event-secret-1234567890' },
    });
    updateAgentRun(run.id, { status: 'streaming', outputSummary: 'streaming output' });

    expect(listAgentEvents({ runId: run.id, category: 'text' })).toEqual([
      expect.objectContaining({
        category: 'text',
        data: { kind: 'text', channel: 'assistant', text: 'I will inspect the files.' },
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'tool' })).toEqual([
      expect.objectContaining({
        type: 'tool_started',
        data: expect.objectContaining({ kind: 'tool', name: 'Read', status: 'started' }),
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'file' })).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'file', path: 'wiki/specs/runtime.md', action: 'updated' }),
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'permission' })).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'permission', action: 'Bash', status: 'requested' }),
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'error' })[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({ kind: 'error', message: 'Authorization: Bearer [redacted]' }),
    }));
    expect(listAgentEvents({ runId: run.id, category: 'status' })[0]).toEqual(expect.objectContaining({
      type: 'run_updated',
      data: expect.objectContaining({ kind: 'status', nextStatus: 'streaming', summary: 'streaming output' }),
    }));
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

  it('persists records and events as an append-only local mind root ledger log', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      permissionMode: 'agent',
      inputSummary: 'persist this run',
    });
    completeAgentRun(run.id, { outputSummary: 'persisted output' });

    const ledgerPath = path.join(getTestMindRoot(), '.mindos', 'agent-run-ledger.jsonl');
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        version: 2,
        type: 'record_upsert',
        record: expect.objectContaining({
          id: run.id,
          status: 'completed',
          outputSummary: 'persisted output',
        }),
      }),
      expect.objectContaining({
        version: 2,
        type: 'event_append',
        event: expect.objectContaining({
          runId: run.id,
          type: 'run_completed',
        }),
      }),
    ]));

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

  it('redacts secrets before storing run summaries, metadata, and JSONL events', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      permissionMode: 'agent',
      inputSummary: 'curl -H "Authorization: Bearer sk-ledger-secret-1234567890" https://example.test?token=abc123',
      metadata: {
        apiKey: 'sk-ledger-secret-abcdefghijkl',
        nested: { authToken: 'token-secret-value' },
      },
    });
    completeAgentRun(run.id, {
      outputSummary: 'token=abc123secret\nDone',
      metadata: {
        headers: { Authorization: 'Bearer ghp_abcdefghijklmnopqrstuvwxyz123456' },
      },
    });

    const record = getAgentRun(run.id);
    expect(record?.inputSummary).toBe('curl -H "Authorization: Bearer [redacted]" https://example.test?token=[redacted]');
    expect(record?.outputSummary).toBe('token=[redacted]\nDone');
    expect(record?.metadata).toEqual({
      apiKey: '[redacted]',
      nested: { authToken: '[redacted]' },
      headers: { Authorization: '[redacted]' },
    });

    const ledgerPath = path.join(getTestMindRoot(), '.mindos', 'agent-run-ledger.jsonl');
    const rawLedger = fs.readFileSync(ledgerPath, 'utf-8');
    expect(rawLedger).not.toContain('sk-ledger-secret');
    expect(rawLedger).not.toContain('abc123secret');
    expect(rawLedger).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(rawLedger).toContain('[redacted]');
  });

  it('loads the legacy full-state JSON ledger and compacts it into the JSONL ledger', () => {
    const mindRoot = getTestMindRoot();
    const ledgerDir = path.join(mindRoot, '.mindos');
    const legacyPath = path.join(ledgerDir, 'agent-run-ledger.json');
    const logPath = path.join(ledgerDir, 'agent-run-ledger.jsonl');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.rmSync(logPath, { force: true });

    const record = {
      id: 'agent-run-legacy',
      rootRunId: 'agent-run-legacy',
      agentKind: 'acp',
      runtimeId: 'legacy-acp',
      displayName: 'Legacy ACP',
      status: 'completed',
      permissionMode: 'readonly',
      inputSummary: 'legacy input',
      outputSummary: 'legacy output',
      startedAt: 100,
      completedAt: 120,
      durationMs: 20,
    };
    const event = {
      id: 'agent-event-legacy',
      runId: record.id,
      type: 'run_completed',
      ts: 120,
      status: 'completed',
      record,
    };
    fs.writeFileSync(legacyPath, JSON.stringify({ version: 1, records: [record], events: [event] }), 'utf-8');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: record.id })).toEqual([
      expect.objectContaining({ id: record.id, outputSummary: 'legacy output' }),
    ]);
    expect(listAgentEvents({ runId: record.id }).map((item) => item.type)).toEqual(['run_completed']);

    expect(fs.existsSync(logPath)).toBe(true);
    const [compact] = fs.readFileSync(logPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(compact).toEqual(expect.objectContaining({
      version: 2,
      type: 'compact',
      records: [expect.objectContaining({ id: record.id })],
      events: [expect.objectContaining({ id: event.id })],
    }));
  });

  it('compacts the JSONL operation log after the size threshold is exceeded', () => {
    const largeSummary = 'x'.repeat(4000);

    for (let index = 0; index < 260; index += 1) {
      const run = startAgentRun({
        agentKind: 'pi-subagent',
        runtimeId: `reviewer-${index}`,
        displayName: `Reviewer ${index}`,
        permissionMode: 'readonly',
        inputSummary: `${index}:${largeSummary}`,
      });
      completeAgentRun(run.id, { outputSummary: `done:${index}:${largeSummary}` });
    }

    const ledgerPath = path.join(getTestMindRoot(), '.mindos', 'agent-run-ledger.jsonl');
    const operations = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(operations[0]).toEqual(expect.objectContaining({
      version: 2,
      type: 'compact',
    }));
    expect(operations.length).toBeLessThan(260 * 4);

    const beforeReload = listAgentRuns({ kind: 'pi-subagent', limit: 500 });
    expect(beforeReload).toHaveLength(260);
    expect(beforeReload[0]).toEqual(expect.objectContaining({
      runtimeId: 'reviewer-259',
      status: 'completed',
    }));

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ kind: 'pi-subagent', limit: 500 })).toHaveLength(260);
    expect(listAgentRuns({ status: 'completed', limit: 500 })).toHaveLength(260);
  });
});
