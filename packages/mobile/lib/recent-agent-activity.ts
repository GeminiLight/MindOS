import {
  formatAgentRunRuntimeLabel,
  formatAgentRunStatus,
  isAgentRunActive,
} from './agent-run-timeline';
import type {
  AgentRunStatus,
  AgentRunTimelineEvent,
  AgentRunTimelineEventData,
  AgentRunTimelineRecord,
  AgentRunsResponse,
} from './types';

export type RecentAgentActivityTone = 'active' | 'success' | 'warning' | 'error' | 'muted';
export type RecentAgentActivityFilter = 'all' | 'active' | 'waiting' | 'issues' | 'done';

export interface RecentAgentActivityItem {
  id: string;
  name: string;
  runtimeLabel: string;
  status: AgentRunStatus;
  statusLabel: string;
  tone: RecentAgentActivityTone;
  detail: string | null;
  startedAt: number;
  completedAt?: number;
  active: boolean;
  pendingUserAction: boolean;
  eventCount: number;
}

export interface RecentAgentActivitySummary {
  items: RecentAgentActivityItem[];
  totalCount: number;
  activeCount: number;
  failedCount: number;
  pendingUserActionCount: number;
  lastUpdatedAt: number | null;
}

export interface RecentAgentActivityFilterOption {
  id: RecentAgentActivityFilter;
  label: string;
  count: number;
}

export const EMPTY_RECENT_AGENT_ACTIVITY: RecentAgentActivitySummary = {
  items: [],
  totalCount: 0,
  activeCount: 0,
  failedCount: 0,
  pendingUserActionCount: 0,
  lastUpdatedAt: null,
};

export function buildRecentAgentActivity(
  payload: AgentRunsResponse | null | undefined,
  options: { limit?: number; now?: number } = {},
): RecentAgentActivitySummary {
  const limit = Math.max(1, options.limit ?? 5);
  const runs = Array.isArray(payload?.runs) ? payload.runs : [];
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const eventsByRun = groupEventsByRun(events);

  const visibleRuns = runs
    .filter((run) => isRecentRunVisible(run))
    .sort((a, b) => latestRunTime(b) - latestRunTime(a) || b.id.localeCompare(a.id));

  const items = visibleRuns
    .slice(0, limit)
    .map((run) => buildRecentAgentActivityItem(run, eventsByRun.get(run.id) ?? []));

  return {
    items,
    totalCount: visibleRuns.length,
    activeCount: visibleRuns.filter(isAgentRunActive).length,
    failedCount: visibleRuns.filter((run) => isFailureStatus(run.status) || Boolean(run.error)).length,
    pendingUserActionCount: visibleRuns.filter((run) => {
      const runEvents = eventsByRun.get(run.id) ?? [];
      return runEvents.some(isPendingUserActionEvent);
    }).length,
    lastUpdatedAt: options.now ?? Date.now(),
  };
}

export function filterRecentAgentActivityItems(
  items: RecentAgentActivityItem[],
  filter: RecentAgentActivityFilter,
): RecentAgentActivityItem[] {
  if (filter === 'all') return items;
  if (filter === 'active') return items.filter((item) => item.active);
  if (filter === 'waiting') return items.filter((item) => item.pendingUserAction);
  if (filter === 'issues') return items.filter((item) => item.tone === 'error');
  return items.filter((item) => item.status === 'completed');
}

export function buildRecentAgentActivityFilterOptions(
  summary: RecentAgentActivitySummary,
): RecentAgentActivityFilterOption[] {
  return [
    { id: 'all', label: 'All', count: summary.totalCount },
    { id: 'active', label: 'Active', count: summary.activeCount },
    { id: 'waiting', label: 'Waiting', count: summary.pendingUserActionCount },
    { id: 'issues', label: 'Issues', count: summary.failedCount },
    {
      id: 'done',
      label: 'Done',
      count: summary.items.filter((item) => item.status === 'completed').length,
    },
  ];
}

export function shouldPollRecentAgentActivity(summary: RecentAgentActivitySummary): boolean {
  return summary.activeCount > 0 || summary.pendingUserActionCount > 0;
}

export function compactAgentActivityError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return 'Agent activity is unavailable. Pull to retry.';
  if (/401|403|token|unauthorized|forbidden/i.test(message)) {
    return 'Agent activity requires a valid access token.';
  }
  if (/timed out|timeout/i.test(message)) {
    return 'Agent activity check timed out. Pull to retry.';
  }
  return compactText(message, 96);
}

function buildRecentAgentActivityItem(
  run: AgentRunTimelineRecord,
  events: AgentRunTimelineEvent[],
): RecentAgentActivityItem {
  const visibleEvents = events
    .filter((event) => event.visibility !== 'debug')
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const latestEvent = visibleEvents.length > 0 ? visibleEvents[visibleEvents.length - 1] : undefined;
  const pendingEvent = findLastPendingUserActionEvent(visibleEvents);
  const active = isAgentRunActive(run);
  const pendingUserAction = Boolean(pendingEvent);
  const runtimeLabel = formatAgentRunRuntimeLabel(run);

  return {
    id: run.id,
    name: run.displayName || runtimeLabel,
    runtimeLabel,
    status: run.status,
    statusLabel: formatAgentRunStatus(run.status),
    tone: toneForRun(run.status, pendingUserAction),
    detail: pendingEvent
      ? describePendingUserAction(pendingEvent)
      : compactNullable(run.error)
        ?? describeEvent(latestEvent)
        ?? compactNullable(run.outputSummary)
        ?? compactNullable(run.inputSummary),
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    active,
    pendingUserAction,
    eventCount: visibleEvents.length,
  };
}

function groupEventsByRun(events: AgentRunTimelineEvent[]): Map<string, AgentRunTimelineEvent[]> {
  const grouped = new Map<string, AgentRunTimelineEvent[]>();
  for (const event of events) {
    const next = grouped.get(event.runId) ?? [];
    next.push(event);
    grouped.set(event.runId, next);
  }
  return grouped;
}

function isRecentRunVisible(run: AgentRunTimelineRecord): boolean {
  if (run.agentKind === 'mindos-main') {
    return isFailureStatus(run.status) || Boolean(run.error);
  }
  return true;
}

function latestRunTime(run: AgentRunTimelineRecord): number {
  return run.completedAt ?? run.startedAt;
}

function isFailureStatus(status: AgentRunStatus): boolean {
  return status === 'failed' || status === 'timed_out' || status === 'canceled';
}

function toneForRun(status: AgentRunStatus, pendingUserAction: boolean): RecentAgentActivityTone {
  if (pendingUserAction) return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'timed_out') return 'error';
  if (status === 'canceled') return 'muted';
  return 'active';
}

function isPendingUserActionEvent(event: AgentRunTimelineEvent): boolean {
  const data = event.data;
  return (data?.kind === 'permission' && data.status === 'requested')
    || (data?.kind === 'question' && data.status === 'requested');
}

function findLastPendingUserActionEvent(
  events: AgentRunTimelineEvent[],
): AgentRunTimelineEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (isPendingUserActionEvent(events[index])) return events[index];
  }
  return undefined;
}

function describePendingUserAction(event: AgentRunTimelineEvent): string {
  if (event.data?.kind === 'permission') {
    const action = compactNullable(event.data.action) ?? 'runtime action';
    return `Host approval needed for ${action}`;
  }
  if (event.data?.kind === 'question') {
    return 'Host is waiting for your answer';
  }
  return 'Host action needed';
}

function describeEvent(event: AgentRunTimelineEvent | undefined): string | null {
  if (!event) return null;
  const data = event.data;
  if (!data) return compactNullable(event.message || event.title);

  switch (data.kind) {
    case 'status':
      return compactNullable(data.summary) ?? formatAgentRunStatus(data.nextStatus);
    case 'text':
      return compactNullable(data.text || event.message);
    case 'tool':
      return describeToolEvent(data, event);
    case 'file':
      return compactNullable(data.summary)
        ?? compactNullable(`${data.action} ${data.path}`);
    case 'permission':
      return data.status === 'requested'
        ? describePendingUserAction(event)
        : compactNullable(data.decisionLabel || data.prompt || event.message);
    case 'question':
      return data.status === 'requested'
        ? describePendingUserAction(event)
        : compactNullable(data.summary || data.prompt || event.message);
    case 'error':
      return compactNullable(data.message);
    default:
      return exhaustiveEventData(data);
  }
}

function describeToolEvent(
  data: Extract<AgentRunTimelineEventData, { kind: 'tool' }>,
  event: AgentRunTimelineEvent,
): string | null {
  const detail = compactNullable(data.error || data.outputSummary || data.inputSummary || event.message);
  if (detail) return detail;
  return compactNullable(data.status ? `${data.name} ${data.status}` : data.name);
}

function compactNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  return compactText(value);
}

function compactText(value: string, limit = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function exhaustiveEventData(_data: never): null {
  return null;
}
