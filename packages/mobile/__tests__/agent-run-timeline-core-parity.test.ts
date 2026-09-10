import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeAgentRunTimelineIntoMessages as mobileMerge,
  preserveAgentRunTimelineParts as mobilePreserve,
} from '@/lib/agent-run-timeline';
// Import the REAL core implementation through the built package subpath
// (allowed in __tests__ — unlike lib/ and app/, which the client-boundary
// contract scans — and skipped by tsc through skipLibCheck, so the core's
// node-typed module graph never enters the mobile program). The core module
// is pure, so Metro compatibility is not a concern here; mobile simply must
// not ship it.
import {
  mergeAgentRunTimelineIntoMessages as coreMerge,
  preserveAgentRunTimelineParts as corePreserve,
} from '@geminilight/mindos/server/projections/agent-run-timeline';
import type {
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  Message,
} from '@/lib/types';

/**
 * Anti-divergence contract (spec-cross-process-run-events E): mobile keeps a
 * local copy of the merge because Metro cannot import product runtime code,
 * while Web and the server use the core projection. The two implementations
 * already diverged once (Web replaced every timeline part, mobile only the
 * same turn); this test feeds identical fixtures to both and fails when the
 * outputs drift apart again.
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

function timelinePart(overrides: Partial<AgentRunTimelinePart> = {}): AgentRunTimelinePart {
  return {
    type: 'agent-run-timeline',
    chatSessionId: 'chat-1',
    startedAfter: 900,
    updatedAt: 1300,
    runs: [run()],
    ...overrides,
  };
}

const FIXTURES: Array<{ name: string; messages: Message[]; timeline: AgentRunTimelinePart }> = [
  {
    name: 'attaches to the newest assistant message, converting content to a text part',
    messages: [
      { role: 'user', content: 'Review', timestamp: 950 },
      { role: 'assistant', content: 'Working on it', timestamp: 960 },
    ],
    timeline: timelinePart(),
  },
  {
    name: 'keeps older-turn timeline parts and replaces only the same turn',
    messages: [{
      role: 'assistant',
      content: 'answer',
      timestamp: 960,
      parts: [
        { type: 'text', text: 'answer' },
        timelinePart({ rootRunId: 'root-old', startedAfter: 100, updatedAt: 200 }),
        timelinePart({ rootRunId: 'root-current' }),
      ],
    }],
    timeline: timelinePart({ rootRunId: 'root-current', updatedAt: 1500, runs: [run({ status: 'failed', error: 'boom' })] }),
  },
  {
    name: 'is a no-op when the visible content did not change',
    messages: [{
      role: 'assistant',
      content: 'answer',
      timestamp: 960,
      parts: [{ type: 'text', text: 'answer' }, timelinePart({ rootRunId: 'root-current' })],
    }],
    timeline: timelinePart({ rootRunId: 'root-current', updatedAt: 9999 }),
  },
  {
    name: 'never attaches to a message older than the turn window',
    messages: [
      { role: 'assistant', content: 'old answer', timestamp: 100 },
      { role: 'user', content: 'current question', timestamp: 950 },
    ],
    timeline: timelinePart({ startedAfter: 900 }),
  },
  {
    name: 'removes a stale same-turn part when no placeholder remains',
    messages: [
      {
        role: 'assistant',
        content: 'old',
        timestamp: 100,
        parts: [{ type: 'text', text: 'old' }, timelinePart({ rootRunId: 'root-current' })],
      },
      { role: 'user', content: 'now', timestamp: 950 },
    ],
    timeline: timelinePart({ rootRunId: 'root-current', updatedAt: 1400 }),
  },
  {
    name: 'moves the current-turn part to the latest valid assistant placeholder',
    messages: [
      {
        role: 'assistant',
        content: 'old answer',
        timestamp: 2,
        parts: [{ type: 'text', text: 'old answer' }, timelinePart({ rootRunId: 'root-current' })],
      },
      { role: 'user', content: 'question', timestamp: 1000 },
      { role: 'assistant', content: '', timestamp: 1001 },
    ],
    timeline: timelinePart({ rootRunId: 'root-current', updatedAt: 1500, runs: [run({ status: 'completed', outputSummary: 'Done.' })] }),
  },
  {
    name: 'returns the input untouched for an empty timeline',
    messages: [{ role: 'assistant', content: 'answer', timestamp: 960 }],
    timeline: timelinePart({ runs: [] }),
  },
];

describe('mobile agent-run-timeline core parity', () => {
  it.each(FIXTURES)('mergeAgentRunTimelineIntoMessages matches core: $name', ({ messages, timeline }) => {
    const mobileResult = mobileMerge(messages, timeline);
    const coreResult = coreMerge(
      messages as Parameters<typeof coreMerge>[0],
      timeline as Parameters<typeof coreMerge>[1],
    );
    expect(JSON.parse(JSON.stringify(mobileResult))).toEqual(JSON.parse(JSON.stringify(coreResult)));
    // Reference-equality semantics are part of the contract too (no-op cases
    // must not clone the array and re-render the message list).
    expect(mobileResult === messages).toBe(coreResult === (messages as Parameters<typeof coreMerge>[0]));
  });

  it('preserveAgentRunTimelineParts matches core', () => {
    const timeline = timelinePart({ rootRunId: 'root-preserve' });
    const previous: Message = {
      role: 'assistant',
      content: 'Working',
      parts: [{ type: 'text', text: 'Working' }, timeline],
    };
    const next: Message = { role: 'assistant', content: 'Working done' };
    const mobileResult = mobilePreserve(previous, next);
    const coreResult = corePreserve(
      previous as Parameters<typeof corePreserve>[0],
      next as Parameters<typeof corePreserve>[1],
    );
    expect(JSON.parse(JSON.stringify(mobileResult))).toEqual(JSON.parse(JSON.stringify(coreResult)));

    const untouched: Message = { role: 'assistant', content: 'x' };
    expect(mobilePreserve(undefined, untouched)).toBe(untouched);
    expect(corePreserve(undefined, untouched as Parameters<typeof corePreserve>[1])).toBe(untouched);
  });

  it('keeps the visibility rules out of the mobile lib (they live in core now)', () => {
    const source = readFileSync(resolve(__dirname, '../lib/agent-run-timeline.ts'), 'utf8');
    expect(source).not.toContain('isTimelineRunVisible');
    expect(source).not.toContain('isActionableTimelineEvent');
    expect(source).not.toContain('selectVisibleAgentRunTimeline');
    expect(source).toContain('spec-cross-process-run-events');
  });
});
