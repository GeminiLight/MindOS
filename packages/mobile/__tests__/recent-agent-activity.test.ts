import { describe, expect, it } from 'vitest';
import {
  buildRecentAgentActivityFilterOptions,
  buildRecentAgentActivity,
  compactAgentActivityError,
  filterRecentAgentActivityItems,
  shouldPollRecentAgentActivity,
} from '@/lib/recent-agent-activity';
import type {
  AgentRunTimelineEvent,
  AgentRunTimelineRecord,
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

describe('recent agent activity mobile summary', () => {
  it('returns an empty summary for missing payloads', () => {
    expect(buildRecentAgentActivity(null, { now: 3000 })).toEqual({
      items: [],
      totalCount: 0,
      activeCount: 0,
      failedCount: 0,
      pendingUserActionCount: 0,
      lastUpdatedAt: 3000,
    });
  });

  it('summarizes recent host runs without showing ordinary MindOS root runs', () => {
    const mindosMain = run({
      id: 'main',
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      startedAt: 500,
      completedAt: 600,
    });
    const codex = run({
      id: 'codex-run',
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      metadata: { runtimeKind: 'codex' },
      startedAt: 1000,
      completedAt: 1200,
    });
    const claude = run({
      id: 'claude-run',
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      status: 'running',
      metadata: { runtimeKind: 'claude' },
      startedAt: 2000,
      completedAt: undefined,
    });
    const reviewer = run({
      id: 'reviewer-run',
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      status: 'failed',
      error: 'Tests failed',
      startedAt: 1400,
      completedAt: 1600,
    });
    const permission = eventFor(claude, {
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

    const summary = buildRecentAgentActivity({
      runs: [mindosMain, codex, claude, reviewer],
      events: [permission],
    }, { limit: 2, now: 2500 });

    expect(summary).toMatchObject({
      totalCount: 3,
      activeCount: 1,
      failedCount: 1,
      pendingUserActionCount: 1,
      lastUpdatedAt: 2500,
    });
    expect(summary.items.map((item) => item.id)).toEqual(['claude-run', 'reviewer-run']);
    expect(summary.items[0]).toMatchObject({
      name: 'Claude Code',
      runtimeLabel: 'Claude Code',
      statusLabel: 'Running',
      tone: 'warning',
      pendingUserAction: true,
      detail: 'Host approval needed for Bash',
    });
    expect(summary.items[1]).toMatchObject({
      runtimeLabel: 'Subagent',
      statusLabel: 'Failed',
      tone: 'error',
      detail: 'Tests failed',
    });
  });

  it('marks pending host questions as user-action items', () => {
    const remote = run({
      id: 'remote-run',
      agentKind: 'a2a',
      runtimeId: 'linear-agent',
      displayName: 'Remote Planner',
      status: 'streaming',
      startedAt: 1000,
      completedAt: undefined,
    });
    const question = eventFor(remote, {
      id: 'question-1',
      type: 'user_question_started',
      category: 'question',
      data: {
        kind: 'question',
        status: 'requested',
        prompt: 'Which issue should I update?',
      },
    });

    const summary = buildRecentAgentActivity({
      runs: [remote],
      events: [question],
    }, { now: 2000 });

    expect(summary.pendingUserActionCount).toBe(1);
    expect(summary.items[0]).toMatchObject({
      runtimeLabel: 'Remote Agent',
      pendingUserAction: true,
      detail: 'Host is waiting for your answer',
    });
  });

  it('builds filter options and filters run lists for the full runs screen', () => {
    const active = run({
      id: 'active-run',
      status: 'running',
      startedAt: 3000,
      completedAt: undefined,
    });
    const done = run({
      id: 'done-run',
      status: 'completed',
      startedAt: 2000,
      completedAt: 2200,
    });
    const failed = run({
      id: 'failed-run',
      status: 'failed',
      error: 'Boom',
      startedAt: 1000,
      completedAt: 1200,
    });
    const waiting = eventFor(active, {
      id: 'permission-1',
      type: 'permission_requested',
      category: 'permission',
      data: {
        kind: 'permission',
        action: 'Bash',
        status: 'requested',
      },
    });

    const summary = buildRecentAgentActivity({
      runs: [failed, done, active],
      events: [waiting],
    }, { now: 4000, limit: 10 });

    expect(buildRecentAgentActivityFilterOptions(summary)).toEqual([
      { id: 'all', label: 'All', count: 3 },
      { id: 'active', label: 'Active', count: 1 },
      { id: 'waiting', label: 'Waiting', count: 1 },
      { id: 'issues', label: 'Issues', count: 1 },
      { id: 'done', label: 'Done', count: 1 },
    ]);
    expect(filterRecentAgentActivityItems(summary.items, 'active').map((item) => item.id)).toEqual(['active-run']);
    expect(filterRecentAgentActivityItems(summary.items, 'waiting').map((item) => item.id)).toEqual(['active-run']);
    expect(filterRecentAgentActivityItems(summary.items, 'issues').map((item) => item.id)).toEqual(['failed-run']);
    expect(filterRecentAgentActivityItems(summary.items, 'done').map((item) => item.id)).toEqual(['done-run']);
  });

  it('polls only while host activity is active or waiting on user action', () => {
    const done = buildRecentAgentActivity({
      runs: [run({ id: 'done-run', status: 'completed' })],
      events: [],
    });
    const active = buildRecentAgentActivity({
      runs: [run({ id: 'active-run', status: 'running', completedAt: undefined })],
      events: [],
    });
    const pendingRun = run({ id: 'waiting-run', status: 'streaming', completedAt: undefined });
    const waiting = buildRecentAgentActivity({
      runs: [pendingRun],
      events: [eventFor(pendingRun, {
        id: 'permission-1',
        type: 'permission_requested',
        category: 'permission',
        data: {
          kind: 'permission',
          action: 'Bash',
          status: 'requested',
        },
      })],
    });

    expect(shouldPollRecentAgentActivity(done)).toBe(false);
    expect(shouldPollRecentAgentActivity(active)).toBe(true);
    expect(shouldPollRecentAgentActivity(waiting)).toBe(true);
  });

  it('compacts noisy activity errors for mobile UI', () => {
    expect(compactAgentActivityError(new Error('Agent activity request timed out after 10000ms'))).toBe(
      'Agent activity check timed out. Pull to retry.',
    );
    expect(compactAgentActivityError(new Error('Unauthorized'))).toBe(
      'Agent activity requires a valid access token.',
    );
    expect(compactAgentActivityError(new Error('x'.repeat(140)))).toHaveLength(96);
  });
});
