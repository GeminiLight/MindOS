import type {
  AgentRunStatus,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  Message,
  MessagePart,
  TextPart,
} from './types';

/**
 * Client-side timeline message operations. The visibility rules (which runs
 * and events a timeline card shows) moved to the core projection
 * `server/projections/agent-run-timeline.ts` (spec-cross-process-run-events E):
 * the server precomputes `payload.timeline` for `GET /api/agent-runs?view=timeline`
 * with the ONE shared implementation. Metro cannot import product runtime
 * code, so the merge below stays local — kept honest against the core module
 * by `__tests__/agent-run-timeline-core-parity.test.ts`.
 */

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
