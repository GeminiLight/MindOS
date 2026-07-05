import { beforeEach, describe, expect, it } from 'vitest';
import {
  listAgentEvents,
  resetAgentRunsForTest,
  startAgentRun,
} from './run-ledger.js';
import { appendSseEventToAgentRun } from './run-timeline-events.js';

describe('appendSseEventToAgentRun', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('ignores hidden status events so transport heartbeats do not pollute the run timeline', () => {
    const run = startAgentRun({
      id: 'run-hidden-status',
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      permissionMode: 'ask',
      inputSummary: 'Quiet turn',
    });

    appendSseEventToAgentRun(run.id, { type: 'status', visible: false, message: 'keep-alive' });

    const events = listAgentEvents({ runId: run.id });
    expect(events.map((event) => event.type)).toEqual(['run_started']);
    expect(events.some((event) => event.type === 'runtime_status' && event.message === 'keep-alive')).toBe(false);
  });

  it('stores native runtime text as debug replay data while preserving actionable status and tool events', () => {
    const run = startAgentRun({
      id: 'run-native',
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      permissionMode: 'ask',
      inputSummary: 'Use Claude Code',
    });

    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'native text' });
    appendSseEventToAgentRun(run.id, { type: 'status', runtime: 'claude', visible: true, message: 'Starting Claude Code locally.' });
    appendSseEventToAgentRun(run.id, { type: 'status', runtime: 'claude', visible: true, message: 'Claude Code HTTP 429; retrying (1/10).' });
    appendSseEventToAgentRun(run.id, { type: 'tool_start', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', args: { command: 'npm test' } });

    const events = listAgentEvents({ runId: run.id });
    expect(events.filter((event) => event.category === 'text')).toEqual([
      expect.objectContaining({
        type: 'text',
        message: 'native text',
        visibility: 'debug',
        data: expect.objectContaining({
          kind: 'text',
          channel: 'assistant',
          text: 'native text',
        }),
      }),
    ]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'runtime_status',
        message: 'Starting Claude Code locally.',
        visibility: 'debug',
      }),
      expect.objectContaining({
        type: 'runtime_status',
        message: 'Claude Code HTTP 429; retrying (1/10).',
      }),
      expect.objectContaining({
        type: 'tool_started',
        category: 'tool',
        runtime: 'claude',
        toolCallId: 'tool-1',
        data: expect.objectContaining({
          kind: 'tool',
          name: 'Bash',
          status: 'started',
          inputSummary: '{"command":"npm test"}',
        }),
      }),
    ]));
    expect(events.find((event) => event.message === 'Claude Code HTTP 429; retrying (1/10).')).not.toHaveProperty('visibility');
  });

  it('writes permission request and resolved audit details into the run timeline', () => {
    const run = startAgentRun({
      id: 'run-permission',
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'ask',
      inputSummary: 'Run tests',
    });

    appendSseEventToAgentRun(run.id, {
      type: 'runtime_permission_request',
      runId: run.id,
      requestId: 'perm-1',
      runtime: 'codex',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      input: { command: 'rm note.md' },
      action: 'command',
      resource: 'rm note.md',
      reason: 'Delete a note',
      risk: {
        level: 'high',
        summary: 'Deletes local files.',
        reasons: ['destructive command'],
      },
      options: [
        { id: 'accept', label: 'Allow once', intent: 'allow', scope: 'once' },
        { id: 'acceptForSession', label: 'Allow this session', intent: 'allow', scope: 'session' },
        { id: 'decline', label: 'Deny', intent: 'deny' },
      ],
    });
    appendSseEventToAgentRun(run.id, {
      type: 'runtime_permission_resolved',
      runId: run.id,
      requestId: 'perm-1',
      runtime: 'codex',
      toolCallId: 'tool-1',
      decision: 'acceptForSession',
      decisionLabel: 'Allow this session',
      decisionIntent: 'allow',
      decisionScope: 'session',
    });

    const events = listAgentEvents({ runId: run.id });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'permission_requested',
        runtime: 'codex',
        toolCallId: 'tool-1',
        metadata: expect.objectContaining({ requestId: 'perm-1', bridgeRunId: 'run-permission' }),
        data: expect.objectContaining({
          kind: 'permission',
          action: 'command',
          status: 'requested',
          requestId: 'perm-1',
          resource: 'rm note.md',
          prompt: 'Delete a note',
          options: expect.arrayContaining([
            expect.objectContaining({ id: 'acceptForSession', intent: 'allow', scope: 'session' }),
          ]),
          risk: expect.objectContaining({ level: 'high', summary: 'Deletes local files.' }),
        }),
      }),
      expect.objectContaining({
        type: 'permission_resolved',
        metadata: expect.objectContaining({ requestId: 'perm-1', bridgeRunId: 'run-permission' }),
        data: expect.objectContaining({
          kind: 'permission',
          status: 'approved',
          requestId: 'perm-1',
          decision: 'acceptForSession',
          decisionLabel: 'Allow this session',
          decisionIntent: 'allow',
          decisionScope: 'session',
        }),
      }),
    ]));
  });
});
