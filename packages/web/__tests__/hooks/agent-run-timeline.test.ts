import { describe, expect, it } from 'vitest';
import { buildAgentRunsTimelineUrl, mergeAgentRunTimelineIntoMessages } from '@/hooks/useAgentRunTimeline';
import type { AgentRunTimelinePart, Message } from '@/lib/types';

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
});
