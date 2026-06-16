import type {
  AgentRunStatus,
  AgentRunTimelineEvent,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  AgentRunsResponse,
  Message,
  MessagePart,
  TextPart,
} from './types';

const TERMINAL_STATUSES = new Set<AgentRunStatus>(['completed', 'failed', 'canceled', 'timed_out']);

export function latestUserMessageTimestamp(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') {
      return typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
        ? message.timestamp
        : Date.now();
    }
  }
  return Date.now();
}

export function selectVisibleAgentRunTimeline(input: {
  payload: AgentRunsResponse;
  chatSessionId: string;
  startedAfter: number;
  rootRunId?: string;
  now?: number;
}): AgentRunTimelinePart | null {
  const runs = Array.isArray(input.payload.runs) ? input.payload.runs : [];
  const events = Array.isArray(input.payload.events) ? input.payload.events : [];
  const eventsByRun = new Map<string, AgentRunTimelineEvent[]>();
  for (const event of events) {
    const next = eventsByRun.get(event.runId) ?? [];
    next.push(event);
    eventsByRun.set(event.runId, next);
  }

  const visibleRuns = runs.filter((run) => isTimelineRunVisible(run, eventsByRun.get(run.id) ?? []));
  const visibleRunIds = new Set(visibleRuns.map((run) => run.id));
  const visibleEvents = events
    .filter((event) => visibleRunIds.has(event.runId))
    .filter(isActionableTimelineEvent);

  if (visibleRuns.length === 0 && visibleEvents.length === 0) return null;
  return {
    type: 'agent-run-timeline',
    chatSessionId: input.chatSessionId,
    ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
    startedAfter: input.startedAfter,
    runs: visibleRuns,
    ...(visibleEvents.length > 0 ? { events: visibleEvents } : {}),
    updatedAt: input.now ?? Date.now(),
  };
}

export function mergeAgentRunTimelineIntoMessages(
  messages: Message[],
  timeline: AgentRunTimelinePart,
): Message[] {
  if (timeline.runs.length === 0) return messages;

  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (canReceiveTimeline(messages[index], timeline)) {
      targetIndex = index;
      break;
    }
  }
  const cleaned = removeMatchingTimelineParts(messages, timeline, targetIndex);
  if (targetIndex < 0) return cleaned;

  const target = cleaned[targetIndex];
  const nextTarget = mergeTimelineIntoMessage(target, timeline);
  if (nextTarget === target) return cleaned === messages ? messages : cleaned;

  const next = cleaned === messages ? [...messages] : [...cleaned];
  next[targetIndex] = nextTarget;
  return next;
}

export function preserveAgentRunTimelineParts(previous: Message | undefined, next: Message): Message {
  const timelineParts = previous?.parts?.filter((part): part is AgentRunTimelinePart => part.type === 'agent-run-timeline') ?? [];
  if (timelineParts.length === 0) return next;
  let changed = false;
  let parts = next.parts && next.parts.length > 0
    ? [...next.parts]
    : next.content
      ? [{ type: 'text', text: next.content } satisfies TextPart]
      : [];

  for (const timeline of timelineParts) {
    const existingIndex = parts.findIndex((part) => isSameTimelineTurn(part, timeline));
    if (existingIndex >= 0) {
      parts[existingIndex] = timeline;
    } else {
      parts = [...parts, timeline];
    }
    changed = true;
  }

  return changed ? { ...next, parts } : next;
}

function mergeTimelineIntoMessage(message: Message, timeline: AgentRunTimelinePart): Message {
  const existingParts = message.parts && message.parts.length > 0
    ? message.parts
    : message.content
      ? [{ type: 'text', text: message.content } satisfies TextPart]
      : [];
  const previousTimeline = existingParts.find((part): part is AgentRunTimelinePart => isSameTimelineTurn(part, timeline));
  if (previousTimeline && serializeTimeline(previousTimeline) === serializeTimeline(timeline)) return message;

  const nextParts: MessagePart[] = [
    ...existingParts.filter((part) => !isSameTimelineTurn(part, timeline)),
    timeline,
  ];
  return {
    ...message,
    parts: nextParts,
  };
}

function canReceiveTimeline(message: Message, timeline: AgentRunTimelinePart): boolean {
  if (message.role !== 'assistant') return false;
  if (
    typeof timeline.startedAfter === 'number'
    && typeof message.timestamp === 'number'
    && message.timestamp < timeline.startedAfter
  ) {
    return false;
  }
  return true;
}

function isSameTimelineTurn(part: MessagePart, timeline: AgentRunTimelinePart): part is AgentRunTimelinePart {
  if (part.type !== 'agent-run-timeline') return false;
  if (part.chatSessionId !== timeline.chatSessionId) return false;
  if (timeline.rootRunId || part.rootRunId) return part.rootRunId === timeline.rootRunId;
  return part.startedAfter === timeline.startedAfter;
}

function removeMatchingTimelineParts(
  messages: Message[],
  timeline: AgentRunTimelinePart,
  keepIndex: number,
): Message[] {
  let changed = false;
  const next = messages.map((message, index) => {
    if (index === keepIndex || !message.parts?.some((part) => isSameTimelineTurn(part, timeline))) {
      return message;
    }
    const parts = message.parts.filter((part) => !isSameTimelineTurn(part, timeline));
    changed = true;
    return parts.length > 0 ? { ...message, parts } : omitParts(message);
  });
  return changed ? next : messages;
}

function omitParts(message: Message): Message {
  const next = { ...message };
  delete next.parts;
  return next;
}

function isActionableTimelineEvent(event: AgentRunTimelineEvent): boolean {
  if (event.visibility === 'debug') return false;
  if (
    event.record?.agentKind === 'native-runtime'
    && (event.category === 'tool' || event.category === 'permission' || event.category === 'question')
  ) {
    return false;
  }
  if (
    event.category === 'tool'
    || event.category === 'file'
    || event.category === 'permission'
    || event.category === 'question'
    || event.category === 'error'
  ) {
    return true;
  }
  if (event.type === 'run_failed' || event.type === 'run_canceled') return true;
  return event.status === 'failed' || event.status === 'timed_out' || event.status === 'canceled';
}

function isTimelineRunVisible(run: AgentRunTimelineRecord, events: AgentRunTimelineEvent[]): boolean {
  if (run.agentKind === 'mindos-main') return false;
  if (run.status === 'failed' || run.status === 'timed_out' || run.status === 'canceled' || Boolean(run.error)) {
    return true;
  }
  if (events.some(isActionableTimelineEvent)) return true;
  if (run.agentKind === 'pi-subagent' || run.agentKind === 'a2a' || run.agentKind === 'mindos-headless') return true;
  if (run.agentKind === 'acp') return Boolean(run.parentRunId && run.parentRunId !== run.id);
  if (run.agentKind !== 'native-runtime') return true;
  return false;
}

function serializeTimeline(part: AgentRunTimelinePart): string {
  return JSON.stringify({
    runs: part.runs.map((run) => ({
      id: run.id,
      status: run.status,
      outputSummary: run.outputSummary,
      error: run.error,
      durationMs: run.durationMs,
      completedAt: run.completedAt,
    })),
    events: (part.events ?? []).map((event) => ({
      id: event.id,
      runId: event.runId,
      type: event.type,
      category: event.category,
      status: event.status,
      message: event.message,
      data: event.data,
      ts: event.ts,
    })),
  });
}

export function formatAgentRunRuntimeLabel(run: AgentRunTimelineRecord): string {
  if (run.agentKind === 'native-runtime') {
    const kind = typeof run.metadata?.runtimeKind === 'string' ? run.metadata.runtimeKind : run.runtimeId;
    if (kind === 'codex') return 'Codex';
    if (kind === 'claude') return 'Claude Code';
  }
  if (run.agentKind === 'pi-subagent') return 'Subagent';
  if (run.agentKind === 'acp') return 'ACP Agent';
  if (run.agentKind === 'a2a') return 'Remote Agent';
  if (run.agentKind === 'mindos-headless') return 'MindOS Headless';
  return 'MindOS Agent';
}

export function formatAgentRunStatus(status: AgentRunStatus): string {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Running';
  if (status === 'streaming') return 'Streaming';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'canceled') return 'Canceled';
  return 'Timed out';
}

export function isAgentRunActive(run: AgentRunTimelineRecord): boolean {
  return !TERMINAL_STATUSES.has(run.status);
}
