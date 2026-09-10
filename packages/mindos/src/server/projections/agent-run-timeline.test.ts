import { describe, expect, it } from 'vitest';
import type {
  AgentRunTimelineEvent,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  Message,
} from '../../agent/stream/stream-message-types.js';
import {
  isActionableTimelineEvent,
  isTimelineRunVisible,
  mergeAgentRunTimelineIntoMessages,
  preserveAgentRunTimelineParts,
  selectVisibleAgentRunTimeline,
} from './agent-run-timeline.js';

/**
 * Table-driven contract for the ONE timeline visibility implementation
 * (spec-cross-process-run-events E). Web imports these functions directly;
 * the server precomputes `timeline` for Mobile with them; the mobile parity
 * test pins mobile's local merge against this module.
 */

function run(overrides: Partial<AgentRunTimelineRecord> = {}): AgentRunTimelineRecord {
  return {
    id: overrides.id ?? 'run-1',
    rootRunId: overrides.rootRunId ?? overrides.id ?? 'run-1',
    agentKind: 'native-runtime',
    runtimeId: 'claude',
    displayName: 'Test Run',
    status: 'completed',
    permissionMode: 'ask',
    inputSummary: 'do things',
    startedAt: 1000,
    ...overrides,
  } as AgentRunTimelineRecord;
}

function event(overrides: Partial<AgentRunTimelineEvent> & { record?: AgentRunTimelineRecord } = {}): AgentRunTimelineEvent {
  const record = overrides.record ?? run();
  return {
    id: overrides.id ?? 'evt-1',
    runId: record.id,
    type: 'text',
    category: 'text',
    status: record.status,
    ts: 1001,
    record,
    ...overrides,
  } as AgentRunTimelineEvent;
}

describe('isActionableTimelineEvent (table)', () => {
  type ActionableCase = {
    name: string;
    agentKind: AgentRunTimelineRecord['agentKind'];
    category: AgentRunTimelineEvent['category'];
    type: string;
    status: string;
    visibility?: 'timeline' | 'debug';
    actionable: boolean;
  };
  const nativeRecord = run({ agentKind: 'native-runtime' });
  const subagentRecord = run({ agentKind: 'pi-subagent' });

  const cases: ActionableCase[] = [
    { name: 'native-runtime tool events render inline in the message', agentKind: 'native-runtime', category: 'tool', type: 'tool_started', status: 'running', actionable: false },
    { name: 'native-runtime permission events render inline', agentKind: 'native-runtime', category: 'permission', type: 'permission_requested', status: 'running', actionable: false },
    { name: 'native-runtime question events render inline', agentKind: 'native-runtime', category: 'question', type: 'user_question_started', status: 'running', actionable: false },
    { name: 'native-runtime error events stay actionable', agentKind: 'native-runtime', category: 'error', type: 'error', status: 'failed', actionable: true },
    { name: 'native-runtime lifecycle events are not actionable', agentKind: 'native-runtime', category: 'status', type: 'run_started', status: 'running', actionable: false },
    { name: 'native-runtime text events are not actionable', agentKind: 'native-runtime', category: 'text', type: 'text', status: 'running', actionable: false },
    { name: 'subagent tool events are actionable', agentKind: 'pi-subagent', category: 'tool', type: 'tool_started', status: 'running', actionable: true },
    { name: 'subagent file events are actionable', agentKind: 'pi-subagent', category: 'file', type: 'file_changed', status: 'running', actionable: true },
    { name: 'subagent permission events are actionable', agentKind: 'pi-subagent', category: 'permission', type: 'permission_requested', status: 'running', actionable: true },
    { name: 'subagent question events are actionable', agentKind: 'pi-subagent', category: 'question', type: 'user_question_started', status: 'running', actionable: true },
    { name: 'subagent error events are actionable', agentKind: 'pi-subagent', category: 'error', type: 'error', status: 'failed', actionable: true },
    { name: 'run_failed is actionable regardless of category', agentKind: 'pi-subagent', category: 'status', type: 'run_failed', status: 'failed', actionable: true },
    { name: 'run_canceled is actionable regardless of category', agentKind: 'pi-subagent', category: 'status', type: 'run_canceled', status: 'canceled', actionable: true },
    { name: 'a failed status makes any event actionable', agentKind: 'pi-subagent', category: 'status', type: 'run_updated', status: 'failed', actionable: true },
    { name: 'a timed_out status makes any event actionable', agentKind: 'pi-subagent', category: 'status', type: 'run_updated', status: 'timed_out', actionable: true },
    { name: 'a canceled status makes any event actionable', agentKind: 'pi-subagent', category: 'status', type: 'run_updated', status: 'canceled', actionable: true },
    { name: 'debug deltas are never actionable', agentKind: 'pi-subagent', category: 'tool', type: 'tool_updated', status: 'running', visibility: 'debug', actionable: false },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const record = testCase.agentKind === 'native-runtime' ? nativeRecord : subagentRecord;
      expect(isActionableTimelineEvent(event({
        record: run({ ...record, agentKind: testCase.agentKind }),
        category: testCase.category,
        type: testCase.type,
        status: testCase.status,
        ...(testCase.visibility ? { visibility: testCase.visibility } : {}),
      }))).toBe(testCase.actionable);
    });
  }
});

describe('isTimelineRunVisible (table)', () => {
  type VisibleCase = {
    name: string;
    agentKind: AgentRunTimelineRecord['agentKind'];
    status?: AgentRunTimelineRecord['status'];
    error?: string;
    parentRunId?: string;
    events?: AgentRunTimelineEvent[];
    visible: boolean;
  };

  const cases: VisibleCase[] = [
    { name: 'mindos-main is the chat turn itself and never renders as a card', agentKind: 'mindos-main', visible: false },
    { name: 'mindos-main stays hidden even when it failed', agentKind: 'mindos-main', status: 'failed', error: 'boom', visible: false },
    { name: 'failed native-runtime runs are visible', agentKind: 'native-runtime', status: 'failed', visible: true },
    { name: 'canceled native-runtime runs are visible', agentKind: 'native-runtime', status: 'canceled', visible: true },
    { name: 'timed_out native-runtime runs are visible', agentKind: 'native-runtime', status: 'timed_out', visible: true },
    { name: 'a completed run carrying an error is visible', agentKind: 'native-runtime', error: 'partial failure', visible: true },
    { name: 'native-runtime without actionable events stays hidden', agentKind: 'native-runtime', visible: false },
    { name: 'native-runtime with only inline tool events stays hidden', agentKind: 'native-runtime', events: [event({ record: run({ agentKind: 'native-runtime' }), category: 'tool', type: 'tool_started', status: 'running' })], visible: false },
    { name: 'native-runtime with an error event becomes visible', agentKind: 'native-runtime', events: [event({ record: run({ agentKind: 'native-runtime' }), category: 'error', type: 'error', status: 'failed' })], visible: true },
    { name: 'pi-subagent runs are unconditionally visible', agentKind: 'pi-subagent', visible: true },
    { name: 'a2a runs are unconditionally visible', agentKind: 'a2a', visible: true },
    { name: 'mindos-headless runs are unconditionally visible', agentKind: 'mindos-headless', visible: true },
    { name: 'root acp runs are the chat turn and stay hidden', agentKind: 'acp', visible: false },
    { name: 'root acp runs whose parentRunId equals their id stay hidden', agentKind: 'acp', parentRunId: 'run-1', visible: false },
    { name: 'delegated acp child runs are visible', agentKind: 'acp', parentRunId: 'parent-1', visible: true },
    { name: 'a failed root acp run is visible despite being the turn root', agentKind: 'acp', status: 'failed', visible: true },
    { name: 'a running pi-subagent without events is visible from its kind alone', agentKind: 'pi-subagent', status: 'running', visible: true },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const candidate = run({
        agentKind: testCase.agentKind,
        ...(testCase.status ? { status: testCase.status } : {}),
        ...(testCase.error ? { error: testCase.error } : {}),
        ...(testCase.parentRunId ? { parentRunId: testCase.parentRunId } : {}),
      });
      expect(isTimelineRunVisible(candidate, testCase.events ?? [])).toBe(testCase.visible);
    });
  }
});

describe('selectVisibleAgentRunTimeline', () => {
  it('returns null when nothing is visible and never invents events for hidden runs', () => {
    const hidden = run({ agentKind: 'mindos-main' });
    expect(selectVisibleAgentRunTimeline({
      payload: { runs: [hidden], events: [event({ record: hidden, category: 'tool', type: 'tool_started', status: 'running' })] },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      now: 1300,
    })).toBeNull();
  });

  it('keeps visible runs, filters their events to actionable ones, and stamps the turn identity', () => {
    const subagent = run({ id: 'sub-1', agentKind: 'pi-subagent', rootRunId: 'root-1' });
    const main = run({ id: 'main-1', agentKind: 'mindos-main', rootRunId: 'root-1' });
    const timeline = selectVisibleAgentRunTimeline({
      payload: {
        runs: [main, subagent],
        events: [
          event({ id: 'e-tool', record: subagent, category: 'tool', type: 'tool_started', status: 'running' }),
          event({ id: 'e-text', record: subagent, category: 'text', type: 'text', status: 'running' }),
          event({ id: 'e-main', record: main, category: 'tool', type: 'tool_started', status: 'running' }),
        ],
      },
      chatSessionId: 'chat-1',
      startedAfter: 900,
      rootRunId: 'root-1',
      now: 1300,
    });
    expect(timeline).toEqual({
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      rootRunId: 'root-1',
      startedAfter: 900,
      runs: [subagent],
      events: [expect.objectContaining({ id: 'e-tool' })],
      updatedAt: 1300,
    } as unknown as AgentRunTimelinePart);
  });

  it('tolerates a payload with missing or malformed arrays', () => {
    expect(selectVisibleAgentRunTimeline({
      payload: {},
      chatSessionId: 'chat-1',
      startedAfter: 0,
      now: 1,
    })).toBeNull();
    expect(selectVisibleAgentRunTimeline({
      payload: { runs: null as unknown as AgentRunTimelineRecord[], events: undefined },
      chatSessionId: 'chat-1',
      startedAfter: 0,
      now: 1,
    })).toBeNull();
  });
});

describe('mergeAgentRunTimelineIntoMessages', () => {
  function timelinePart(overrides: Partial<AgentRunTimelinePart> = {}): AgentRunTimelinePart {
    return {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 900,
      updatedAt: 1000,
      runs: [run({ id: 'run-current', startedAt: 1000 })],
      ...overrides,
    };
  }

  it('returns the same array when the timeline has no runs', () => {
    const messages: Message[] = [{ role: 'assistant', content: 'hi' }];
    expect(mergeAgentRunTimelineIntoMessages(messages, timelinePart({ runs: [] }))).toBe(messages);
  });

  it('attaches to the newest assistant message, converting content to a text part', () => {
    const messages: Message[] = [
      { role: 'user', content: 'go', timestamp: 950 },
      { role: 'assistant', content: 'working', timestamp: 960 },
    ];
    const timeline = timelinePart();
    const next = mergeAgentRunTimelineIntoMessages(messages, timeline);
    expect(next).not.toBe(messages);
    expect(next[1].parts).toEqual([{ type: 'text', text: 'working' }, timeline]);
    expect(next[1].content).toBe('working');
  });

  it('replaces only the same-turn timeline part and keeps older-turn parts', () => {
    const oldTurn = timelinePart({ rootRunId: 'root-old', startedAfter: 100, updatedAt: 200 });
    const currentTurn = timelinePart({ rootRunId: 'root-current' });
    const updatedTurn = timelinePart({
      rootRunId: 'root-current',
      updatedAt: 1500,
      runs: [run({ id: 'run-current', status: 'failed', error: 'boom', startedAt: 1000 })],
    });
    const messages: Message[] = [{
      role: 'assistant',
      content: 'answer',
      timestamp: 960,
      parts: [{ type: 'text', text: 'answer' }, oldTurn, currentTurn],
    }];
    const next = mergeAgentRunTimelineIntoMessages(messages, updatedTurn);
    expect(next[0].parts).toEqual([
      { type: 'text', text: 'answer' },
      oldTurn,
      updatedTurn,
    ]);
  });

  it('is a no-op (same reference) when the visible content did not change', () => {
    const timeline = timelinePart({ rootRunId: 'root-current' });
    const sameContentDifferentUpdatedAt = timelinePart({ rootRunId: 'root-current', updatedAt: 9999 });
    const messages: Message[] = [{
      role: 'assistant',
      content: 'answer',
      timestamp: 960,
      parts: [{ type: 'text', text: 'answer' }, timeline],
    }];
    expect(mergeAgentRunTimelineIntoMessages(messages, sameContentDifferentUpdatedAt)).toBe(messages);
  });

  it('never attaches to an assistant message older than the turn window', () => {
    const timeline = timelinePart({ startedAfter: 900 });
    const messages: Message[] = [
      { role: 'assistant', content: 'old answer', timestamp: 100 },
      { role: 'user', content: 'current question', timestamp: 950 },
    ];
    expect(mergeAgentRunTimelineIntoMessages(messages, timeline)).toBe(messages);
  });

  it('removes a stale same-turn part from an old message when no placeholder remains', () => {
    const stale = timelinePart({ rootRunId: 'root-current' });
    const messages: Message[] = [
      { role: 'assistant', content: 'old', timestamp: 100, parts: [{ type: 'text', text: 'old' }, stale] },
      { role: 'user', content: 'now', timestamp: 950 },
    ];
    const next = mergeAgentRunTimelineIntoMessages(messages, timelinePart({ rootRunId: 'root-current', updatedAt: 1200 }));
    expect(next[0].parts).toEqual([{ type: 'text', text: 'old' }]);
  });
});

describe('preserveAgentRunTimelineParts', () => {
  it('carries previous timeline parts onto a rebuilt message without one', () => {
    const timeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      startedAfter: 900,
      updatedAt: 1000,
      runs: [run()],
    };
    const previous: Message = { role: 'assistant', content: 'old', parts: [{ type: 'text', text: 'old' }, timeline] };
    const next: Message = { role: 'assistant', content: 'new' };
    const merged = preserveAgentRunTimelineParts(previous, next);
    expect(merged.parts).toEqual([{ type: 'text', text: 'new' }, timeline]);
  });

  it('returns the next message untouched when the previous had no timeline parts', () => {
    const next: Message = { role: 'assistant', content: 'new' };
    expect(preserveAgentRunTimelineParts({ role: 'assistant', content: 'old' }, next)).toBe(next);
    expect(preserveAgentRunTimelineParts(undefined, next)).toBe(next);
  });
});
