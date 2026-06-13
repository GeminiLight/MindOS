import { describe, expect, it } from 'vitest';
import {
  buildAgentRunsTimelineStreamUrl,
  buildAgentRunsTimelineUrl,
  mergeAgentRunTimelineIntoMessages,
  selectVisibleAgentRunTimeline,
} from '@/hooks/useAgentRunTimeline';
import type { AgentRunTimelineEvent, AgentRunTimelinePart, AgentRunTimelineRecord, Message } from '@/lib/types';

function nativeRun(overrides: Partial<AgentRunTimelineRecord> = {}): AgentRunTimelineRecord {
  return {
    id: 'native-run-1',
    chatSessionId: 'chat-1',
    rootRunId: 'native-run-1',
    agentKind: 'native-runtime',
    runtimeId: 'claude',
    displayName: 'Claude Code',
    status: 'completed',
    permissionMode: 'agent',
    inputSummary: 'Say hello',
    outputSummary: 'Hello',
    startedAt: 1000,
    completedAt: 1200,
    durationMs: 200,
    metadata: { runtimeKind: 'claude' },
    ...overrides,
  };
}

function eventFor(
  run: AgentRunTimelineRecord,
  event: Partial<AgentRunTimelineEvent> & Pick<AgentRunTimelineEvent, 'id' | 'type' | 'category'>,
): AgentRunTimelineEvent {
  return {
    runId: run.id,
    status: run.status,
    ts: run.startedAt + 1,
    record: run,
    ...event,
  };
}

describe('mergeAgentRunTimelineIntoMessages', () => {
  it('builds root-scoped query urls before falling back to startedAfter', () => {
    expect(buildAgentRunsTimelineUrl({
      chatSessionId: 'chat-1',
      rootRunId: 'root-1',
      startedAfter: 100,
    })).toBe('/api/agent-runs?chatSessionId=chat-1&limit=50&rootRunId=root-1');

    expect(buildAgentRunsTimelineUrl({
      chatSessionId: 'chat-1',
      startedAfter: 100,
      limit: 20,
    })).toBe('/api/agent-runs?chatSessionId=chat-1&limit=20&startedAfter=100');

    expect(buildAgentRunsTimelineStreamUrl({
      chatSessionId: 'chat-1',
      rootRunId: 'root-1',
      startedAfter: 100,
    })).toBe('/api/agent-runs/stream?chatSessionId=chat-1&limit=50&rootRunId=root-1');

    expect(buildAgentRunsTimelineStreamUrl({
      chatSessionId: 'chat-1',
      startedAfter: 100,
      limit: 20,
    })).toBe('/api/agent-runs/stream?chatSessionId=chat-1&limit=20&startedAfter=100');
  });

  it('adds a timeline part to the latest assistant message without dropping text content', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Review this', timestamp: 1 },
      { role: 'assistant', content: 'Initial answer', timestamp: 2 },
    ];
    const timeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 1,
      updatedAt: 3,
      runs: [
        {
          id: 'run-1',
          agentKind: 'pi-subagent',
          runtimeId: 'reviewer',
          displayName: 'Reviewer',
          status: 'completed',
          permissionMode: 'readonly',
          inputSummary: 'Review',
          outputSummary: 'Looks good.',
          startedAt: 2,
          completedAt: 3,
          durationMs: 1,
        },
      ],
    };

    const next = mergeAgentRunTimelineIntoMessages(messages, timeline);

    expect(next).not.toBe(messages);
    expect(next[1].content).toBe('Initial answer');
    expect(next[1].parts).toEqual([
      { type: 'text', text: 'Initial answer' },
      timeline,
    ]);
  });

  it('updates an existing timeline part instead of appending duplicates', () => {
    const firstTimeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      updatedAt: 1,
      runs: [
        {
          id: 'run-1',
          agentKind: 'acp',
          runtimeId: 'gemini',
          displayName: 'Gemini',
          status: 'running',
          permissionMode: 'agent',
          inputSummary: 'Ask Gemini',
          startedAt: 1,
        },
      ],
    };
    const nextTimeline: AgentRunTimelinePart = {
      ...firstTimeline,
      updatedAt: 2,
      runs: [{ ...firstTimeline.runs[0], status: 'completed', outputSummary: 'Done.' }],
    };
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Answer',
        parts: [{ type: 'text', text: 'Answer' }, firstTimeline],
      },
    ];

    const next = mergeAgentRunTimelineIntoMessages(messages, nextTimeline);

    expect(next[0].parts?.filter((part) => part.type === 'agent-run-timeline')).toHaveLength(1);
    expect(next[0].parts?.[1]).toEqual(nextTimeline);
  });

  it('updates an existing timeline part when only fine-grained events change', () => {
    const baseTimeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      rootRunId: 'root-1',
      updatedAt: 1,
      runs: [
        {
          id: 'run-1',
          rootRunId: 'root-1',
          agentKind: 'native-runtime',
          runtimeId: 'claude',
          displayName: 'Claude Code',
          status: 'running',
          permissionMode: 'agent',
          inputSummary: 'Use Claude',
          startedAt: 1,
        },
      ],
      events: [
        {
          id: 'event-1',
          runId: 'run-1',
          type: 'text',
          category: 'text',
          status: 'running',
          ts: 2,
          record: {
            id: 'run-1',
            rootRunId: 'root-1',
            agentKind: 'native-runtime',
            runtimeId: 'claude',
            displayName: 'Claude Code',
            status: 'running',
            permissionMode: 'agent',
            inputSummary: 'Use Claude',
            startedAt: 1,
          },
          data: { kind: 'text', text: 'starting' },
        },
      ],
    };
    const nextTimeline: AgentRunTimelinePart = {
      ...baseTimeline,
      updatedAt: 2,
      events: [
        ...baseTimeline.events!,
        {
          id: 'event-2',
          runId: 'run-1',
          type: 'tool_started',
          category: 'tool',
          status: 'running',
          ts: 3,
          record: baseTimeline.events![0].record,
          data: { kind: 'tool', name: 'Bash', status: 'started' },
        },
      ],
    };
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Answer',
        parts: [{ type: 'text', text: 'Answer' }, baseTimeline],
      },
    ];

    const next = mergeAgentRunTimelineIntoMessages(messages, nextTimeline);

    expect(next[0].parts?.filter((part) => part.type === 'agent-run-timeline')).toHaveLength(1);
    expect((next[0].parts?.[1] as AgentRunTimelinePart).events?.map((event) => event.id)).toEqual(['event-1', 'event-2']);
  });

  it('does not attach a current-turn timeline to an assistant message from an older turn', () => {
    const timeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 900,
      updatedAt: 1100,
      runs: [
        {
          id: 'run-current',
          agentKind: 'native-runtime',
          runtimeId: 'codex',
          displayName: 'Codex',
          status: 'failed',
          permissionMode: 'agent',
          startedAt: 1000,
          error: 'stopped',
        },
      ],
    };
    const messages: Message[] = [
      { role: 'user', content: 'Old question', timestamp: 1 },
      { role: 'assistant', content: 'Old answer', timestamp: 2 },
      { role: 'user', content: 'Current question', timestamp: 1000 },
    ];

    expect(mergeAgentRunTimelineIntoMessages(messages, timeline)).toBe(messages);
  });

  it('removes a current-turn timeline from an old assistant when the active placeholder is gone', () => {
    const oldTimeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 900,
      updatedAt: 1000,
      runs: [
        {
          id: 'run-current',
          agentKind: 'native-runtime',
          runtimeId: 'codex',
          displayName: 'Codex',
          status: 'running',
          permissionMode: 'agent',
          startedAt: 1000,
        },
      ],
    };
    const nextTimeline: AgentRunTimelinePart = {
      ...oldTimeline,
      updatedAt: 1100,
      runs: [{ ...oldTimeline.runs[0], status: 'canceled' }],
    };
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Old answer',
        timestamp: 2,
        parts: [{ type: 'text', text: 'Old answer' }, oldTimeline],
      },
      { role: 'user', content: 'Current question', timestamp: 1000 },
    ];

    const next = mergeAgentRunTimelineIntoMessages(messages, nextTimeline);

    expect(next).not.toBe(messages);
    expect(next[0].parts).toEqual([{ type: 'text', text: 'Old answer' }]);
  });

  it('moves an existing current-turn timeline to the latest valid assistant placeholder', () => {
    const oldTimeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      rootRunId: 'root-current',
      startedAfter: 900,
      updatedAt: 1000,
      runs: [
        {
          id: 'run-current',
          rootRunId: 'root-current',
          agentKind: 'pi-subagent',
          runtimeId: 'reviewer',
          displayName: 'Reviewer',
          status: 'running',
          permissionMode: 'readonly',
          startedAt: 1000,
        },
      ],
    };
    const nextTimeline: AgentRunTimelinePart = {
      ...oldTimeline,
      updatedAt: 1100,
      runs: [{ ...oldTimeline.runs[0], status: 'completed', outputSummary: 'Done.' }],
    };
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Old answer',
        timestamp: 2,
        parts: [{ type: 'text', text: 'Old answer' }, oldTimeline],
      },
      { role: 'user', content: 'Current question', timestamp: 1000 },
      { role: 'assistant', content: '', timestamp: 1001 },
    ];

    const next = mergeAgentRunTimelineIntoMessages(messages, nextTimeline);

    expect(next[0].parts).toEqual([{ type: 'text', text: 'Old answer' }]);
    expect(next[2].parts).toEqual([nextTimeline]);
  });
});

describe('selectVisibleAgentRunTimeline', () => {
  it('suppresses an ordinary native-runtime chat turn with only lifecycle, status, and text events', () => {
    const run = nativeRun();
    const timeline = selectVisibleAgentRunTimeline({
      payload: {
        runs: [run],
        events: [
          eventFor(run, {
            id: 'started',
            type: 'run_started',
            category: 'status',
            data: { kind: 'status', nextStatus: 'running', summary: 'started' },
          }),
          eventFor(run, {
            id: 'status-starting',
            type: 'runtime_status',
            category: 'status',
            message: 'Starting Claude Code locally.',
            data: { kind: 'status', nextStatus: 'running', summary: 'Starting Claude Code locally.' },
          }),
          eventFor(run, {
            id: 'assistant-text',
            type: 'text',
            category: 'text',
            message: 'Hi there',
            data: { kind: 'text', channel: 'assistant', text: 'Hi there' },
          }),
          eventFor(run, {
            id: 'completed',
            type: 'run_completed',
            category: 'status',
            data: { kind: 'status', nextStatus: 'completed', summary: 'completed' },
          }),
        ],
      },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      now: 1300,
    });

    expect(timeline).toBeNull();
  });

  it('shows native-runtime turns with actionable tool events and strips text/status noise', () => {
    const run = nativeRun();
    const timeline = selectVisibleAgentRunTimeline({
      payload: {
        runs: [run],
        events: [
          eventFor(run, {
            id: 'assistant-text',
            type: 'text',
            category: 'text',
            message: 'I will run tests',
            data: { kind: 'text', channel: 'assistant', text: 'I will run tests' },
          }),
          eventFor(run, {
            id: 'status-connected',
            type: 'runtime_status',
            category: 'status',
            message: 'Claude Code is connected and working in this chat.',
            data: { kind: 'status', nextStatus: 'running', summary: 'Claude Code is connected and working in this chat.' },
          }),
          eventFor(run, {
            id: 'tool-started',
            type: 'tool_started',
            category: 'tool',
            message: 'Bash',
            toolName: 'Bash',
            data: { kind: 'tool', name: 'Bash', status: 'started', inputSummary: 'npm test' },
          }),
        ],
      },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      now: 1300,
    });

    expect(timeline?.runs.map((item) => item.id)).toEqual(['native-run-1']);
    expect(timeline?.events?.map((event) => event.id)).toEqual(['tool-started']);
  });

  it('shows native-runtime permission, question, and error events while stripping status noise', () => {
    const run = nativeRun();
    const timeline = selectVisibleAgentRunTimeline({
      payload: {
        runs: [run],
        events: [
          eventFor(run, {
            id: 'status-retry',
            type: 'runtime_status',
            category: 'status',
            message: 'Claude Code HTTP 429; retrying (1/10).',
            data: { kind: 'status', nextStatus: 'running', summary: 'Claude Code HTTP 429; retrying (1/10).' },
          }),
          eventFor(run, {
            id: 'permission-requested',
            type: 'permission_requested',
            category: 'permission',
            message: 'Allow command?',
            data: { kind: 'permission', action: 'Bash', status: 'requested', prompt: 'Allow command?' },
          }),
          eventFor(run, {
            id: 'question-started',
            type: 'user_question_started',
            category: 'question',
            message: 'Choose a branch',
            data: { kind: 'question', status: 'requested', prompt: 'Choose a branch' },
          }),
          eventFor(run, {
            id: 'runtime-error',
            type: 'error',
            category: 'error',
            message: 'Command failed',
            status: 'failed',
            data: { kind: 'error', message: 'Command failed' },
          }),
        ],
      },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      now: 1300,
    });

    expect(timeline?.runs.map((item) => item.id)).toEqual(['native-run-1']);
    expect(timeline?.events?.map((event) => event.id)).toEqual([
      'permission-requested',
      'question-started',
      'runtime-error',
    ]);
  });

  it('keeps failed native-runtime turns visible even when no tool event was recorded', () => {
    const run = nativeRun({
      status: 'failed',
      error: 'Claude Code native runtime error: process exited',
      completedAt: 1200,
      durationMs: 200,
    });
    const timeline = selectVisibleAgentRunTimeline({
      payload: { runs: [run], events: [] },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      now: 1300,
    });

    expect(timeline?.runs).toEqual([run]);
    expect(timeline?.events).toBeUndefined();
  });

  it('keeps non-native agent runs visible without requiring actionable events', () => {
    const run: AgentRunTimelineRecord = {
      id: 'acp-run-1',
      chatSessionId: 'chat-1',
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini ACP',
      status: 'completed',
      permissionMode: 'agent',
      inputSummary: 'Ask external agent',
      outputSummary: 'Done',
      startedAt: 1000,
      completedAt: 1200,
      durationMs: 200,
    };
    const timeline = selectVisibleAgentRunTimeline({
      payload: { runs: [run], events: [] },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      now: 1300,
    });

    expect(timeline?.runs).toEqual([run]);
  });
});
