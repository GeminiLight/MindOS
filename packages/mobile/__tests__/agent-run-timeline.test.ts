import { describe, expect, it } from 'vitest';
import {
  mergeAgentRunTimelineIntoMessages,
  preserveAgentRunTimelineParts,
  selectVisibleAgentRunTimeline,
} from '@/lib/agent-run-timeline';
import type {
  AgentRunTimelineEvent,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  Message,
} from '@/lib/types';

function run(overrides: Partial<AgentRunTimelineRecord> = {}): AgentRunTimelineRecord {
  return {
    id: 'run-1',
    chatSessionId: 'chat-1',
    rootRunId: 'run-1',
    agentKind: 'pi-subagent',
    runtimeId: 'reviewer',
    displayName: 'Reviewer',
    status: 'completed',
    permissionMode: 'agent',
    inputSummary: 'Review the repo',
    outputSummary: 'Looks good.',
    startedAt: 1000,
    completedAt: 1200,
    durationMs: 200,
    ...overrides,
  };
}

function eventFor(
  record: AgentRunTimelineRecord,
  event: Partial<AgentRunTimelineEvent> & Pick<AgentRunTimelineEvent, 'id' | 'type' | 'category'>,
): AgentRunTimelineEvent {
  return {
    runId: record.id,
    status: record.status,
    ts: record.startedAt + 1,
    record,
    ...event,
  };
}

describe('agent-run-timeline mobile projection', () => {
  it('selects visible Pi/subagent runs and actionable permission events', () => {
    const subagent = run();
    const mindosMain = run({
      id: 'main',
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
    });
    const permissionEvent = eventFor(subagent, {
      id: 'permission-1',
      type: 'permission_requested',
      category: 'permission',
      data: {
        kind: 'permission',
        action: 'Bash',
        status: 'requested',
        prompt: 'Allow command?',
      },
    });

    const timeline = selectVisibleAgentRunTimeline({
      payload: {
        runs: [mindosMain, subagent],
        events: [permissionEvent],
      },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      now: 1300,
    });

    expect(timeline).toMatchObject({
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 900,
      updatedAt: 1300,
    });
    expect(timeline?.runs.map((item) => item.id)).toEqual(['run-1']);
    expect(timeline?.events?.map((item) => item.id)).toEqual(['permission-1']);
  });

  it('does not show ordinary successful native runs without actionable events', () => {
    const native = run({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      metadata: { runtimeKind: 'codex' },
    });

    expect(selectVisibleAgentRunTimeline({
      payload: { runs: [native], events: [] },
      chatSessionId: 'chat-1',
      startedAfter: 900,
    })).toBeNull();
  });

  it('merges a timeline into the latest assistant message without dropping text content', () => {
    const timeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 900,
      updatedAt: 1300,
      runs: [run()],
    };
    const messages: Message[] = [
      { role: 'user', content: 'Review', timestamp: 1000 },
      { role: 'assistant', content: 'Working on it', timestamp: 1001 },
    ];

    const next = mergeAgentRunTimelineIntoMessages(messages, timeline);

    expect(next).not.toBe(messages);
    expect(next[1].content).toBe('Working on it');
    expect(next[1].parts).toEqual([
      { type: 'text', text: 'Working on it' },
      timeline,
    ]);
  });

  it('preserves timeline parts when streaming text replaces the assistant snapshot', () => {
    const timeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 900,
      updatedAt: 1300,
      runs: [run()],
    };
    const previous: Message = {
      role: 'assistant',
      content: 'Working',
      parts: [{ type: 'text', text: 'Working' }, timeline],
    };
    const nextSnapshot: Message = {
      role: 'assistant',
      content: 'Working done',
      parts: [{ type: 'text', text: 'Working done' }],
    };

    expect(preserveAgentRunTimelineParts(previous, nextSnapshot).parts).toEqual([
      { type: 'text', text: 'Working done' },
      timeline,
    ]);
  });
});
