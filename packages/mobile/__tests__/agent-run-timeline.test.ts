import { describe, expect, it } from 'vitest';
import {
  mergeAgentRunTimelineIntoMessages,
  preserveAgentRunTimelineParts,
} from '@/lib/agent-run-timeline';
import type {
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  Message,
} from '@/lib/types';

/**
 * Mobile keeps only the client-side message operations; the visibility rules
 * live in the core projection (server/projections/agent-run-timeline.ts) and
 * the merge parity between the two copies is pinned by
 * agent-run-timeline-core-parity.test.ts (spec-cross-process-run-events E).
 */

function run(overrides: Partial<AgentRunTimelineRecord> = {}): AgentRunTimelineRecord {
  return {
    id: 'run-1',
    chatSessionId: 'chat-1',
    rootRunId: 'run-1',
    agentKind: 'pi-subagent',
    runtimeId: 'reviewer',
    displayName: 'Reviewer',
    status: 'completed',
    permissionMode: 'ask',
    inputSummary: 'Review the repo',
    outputSummary: 'Looks good.',
    startedAt: 1000,
    completedAt: 1200,
    durationMs: 200,
    ...overrides,
  };
}

describe('agent-run-timeline mobile message operations', () => {

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
