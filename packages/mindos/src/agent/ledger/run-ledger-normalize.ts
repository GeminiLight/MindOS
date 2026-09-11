import { readLegacyMindosPermissionMode } from '../permission/index.js';
import { redactSensitiveObject, redactSensitiveText } from '../../foundation/security/redaction.js';
import type {
  AgentEvent,
  AgentEventCategory,
  AgentEventData,
  AgentEventType,
  AgentRunArchiveRef,
  AgentRunPermissionMode,
  AgentRunRecord,
  AgentRunStatus,
  AppendAgentEventInput,
} from './run-ledger-types.js';

/**
 * Pure normalization for the agent run ledger: record/event shape checks,
 * redaction, summary truncation, and the default typed `data` payload for
 * events that arrive without one. No I/O; shared by the live writer and the
 * legacy importer.
 */

const MAX_SUMMARY_CHARS = 4000;

export function nowMs(): number {
  return Date.now();
}

export function createRunId(): string {
  return `agent-run-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEventId(): string {
  return `agent-event-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function truncateSummary(value: unknown): string {
  if (typeof value === 'string') {
    const redacted = redactSensitiveText(value);
    return redacted.length > MAX_SUMMARY_CHARS ? `${redacted.slice(0, MAX_SUMMARY_CHARS)}...` : redacted;
  }
  if (value == null) return '';
  try {
    const serialized = JSON.stringify(redactSensitiveObject(value));
    return serialized.length > MAX_SUMMARY_CHARS ? `${serialized.slice(0, MAX_SUMMARY_CHARS)}...` : serialized;
  } catch {
    return redactSensitiveText(String(value));
  }
}

export function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveObject(metadata) as Record<string, unknown>;
}

export function normalizePermissionMode(mode: unknown): AgentRunPermissionMode {
  return readLegacyMindosPermissionMode(mode);
}

export function normalizeArchiveRef(value: AgentRunArchiveRef | undefined): AgentRunArchiveRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const archive: AgentRunArchiveRef = {};
  if (typeof value.sessionId === 'string' && value.sessionId.trim()) archive.sessionId = truncateSummary(value.sessionId);
  if (typeof value.path === 'string' && value.path.trim()) archive.path = truncateSummary(value.path);
  return Object.keys(archive).length > 0 ? archive : undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isTerminalStatus(status: AgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timed_out';
}

export function recordWriteTs(record: AgentRunRecord): number {
  return record.completedAt ?? record.startedAt;
}

/**
 * Orphaned runs: the owning process died before reaching a terminal status.
 * Marked failed at read time, as a projection — the stored row is never
 * rewritten, so every reader computes the same result from the same evidence.
 */
export function markOrphanedRun(record: AgentRunRecord): AgentRunRecord {
  return {
    ...record,
    status: 'failed',
    error: record.error ?? 'MindOS process that owned this run exited before it finished.',
    metadata: { ...(record.metadata ?? {}), failureReason: 'process-died' },
  };
}

export function normalizeRecord(value: unknown): AgentRunRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AgentRunRecord>;
  if (typeof record.id !== 'string' || typeof record.runtimeId !== 'string' || typeof record.displayName !== 'string') return null;
  if (typeof record.startedAt !== 'number' || typeof record.inputSummary !== 'string') return null;
  if (!record.agentKind || !record.status || !record.permissionMode) return null;
  return record as AgentRunRecord;
}

export function normalizeEvent(value: unknown): AgentEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<AgentEvent>;
  if (typeof event.id !== 'string' || typeof event.runId !== 'string' || typeof event.type !== 'string') return null;
  if (typeof event.ts !== 'number' || !event.status || !event.record) return null;
  const type = event.type as AgentEventType;
  const category = normalizeEventCategory(event.category, type);
  return {
    ...(event as AgentEvent),
    type,
    category,
    ...(event.message !== undefined ? { message: truncateSummary(event.message) } : {}),
    data: normalizeAgentEventData(event.data, category, event as AgentEvent),
    ...(event.metadata ? { metadata: redactMetadata(event.metadata) } : {}),
  };
}

export function normalizeEventCategory(value: unknown, type: AgentEventType): AgentEventCategory {
  if (value === 'status' || value === 'text' || value === 'tool' || value === 'file' || value === 'permission' || value === 'question' || value === 'plan' || value === 'goal' || value === 'error') {
    return value;
  }
  if (type === 'text') return 'text';
  if (type === 'tool_started' || type === 'tool_updated' || type === 'tool_completed') return 'tool';
  if (type === 'file_changed') return 'file';
  if (type === 'permission_requested' || type === 'permission_resolved') return 'permission';
  if (type === 'user_question_started' || type === 'user_question_resolved') return 'question';
  if (type === 'plan_artifact') return 'plan';
  if (type === 'goal_evaluation') return 'goal';
  if (type === 'run_failed' || type === 'error') return 'error';
  if (type === 'tool') return 'tool';
  if (type === 'file') return 'file';
  if (type === 'permission') return 'permission';
  if (type === 'status' || type === 'runtime_status') return 'status';
  return 'status';
}

function truncateEventDataValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncateSummary(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => truncateEventDataValue(item, depth + 1));
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = truncateEventDataValue(item, depth + 1);
  }
  return next;
}

function redactEventData(data: AgentEventData | undefined): AgentEventData | undefined {
  if (!data) return undefined;
  return truncateEventDataValue(redactSensitiveObject(data)) as AgentEventData;
}

function statusLabel(status: AgentRunStatus): string {
  return status === 'timed_out' ? 'timed out' : status.replace(/_/g, ' ');
}

function defaultEventData(
  record: AgentRunRecord,
  type: AgentEventType,
  category: AgentEventCategory,
  message?: unknown,
  input?: Partial<AppendAgentEventInput>,
): AgentEventData {
  const summary = message === undefined ? undefined : truncateSummary(message);
  if (category === 'error') {
    return {
      kind: 'error',
      message: summary || record.error || statusLabel(record.status),
    };
  }
  if (category === 'text') {
    return {
      kind: 'text',
      text: summary || '',
      channel: 'assistant',
    };
  }
  if (category === 'tool') {
    const status = type === 'tool_started'
      ? 'started'
      : type === 'tool_completed'
        ? 'completed'
        : undefined;
    return {
      kind: 'tool',
      name: input?.toolName ? truncateSummary(input.toolName) : 'tool',
      ...(status ? { status } : {}),
      ...(summary ? { outputSummary: summary } : {}),
    };
  }
  if (category === 'file') {
    return {
      kind: 'file',
      path: input?.filePath ? truncateSummary(input.filePath) : 'unknown',
      action: 'unknown',
      ...(summary ? { summary } : {}),
    };
  }
  if (category === 'permission') {
    return {
      kind: 'permission',
      action: input?.toolName ? truncateSummary(input.toolName) : 'approval',
      status: type === 'permission_resolved' || type === 'user_question_resolved' ? 'approved' : 'requested',
      ...(input?.filePath ? { resource: truncateSummary(input.filePath) } : {}),
      ...(summary ? { prompt: summary } : {}),
    };
  }
  if (category === 'question') {
    return {
      kind: 'question',
      status: type === 'user_question_resolved' ? 'answered' : 'requested',
      ...(summary ? { prompt: summary } : {}),
    };
  }
  if (category === 'plan') {
    return {
      kind: 'plan',
      schemaVersion: 1,
      mode: 'plan',
      summary: summary || 'Plan artifact recorded.',
      steps: [],
      risks: [],
      source: 'fallback',
      generatedAt: nowMs(),
    };
  }
  if (category === 'goal') {
    return {
      kind: 'goal',
      schemaVersion: 1,
      mode: 'goal',
      objective: 'Complete the requested goal.',
      status: type === 'run_failed' ? 'blocked' : 'completed',
      confidence: 'low',
      summary: summary || 'Goal evaluation recorded.',
      evidence: [],
      evaluatedAt: nowMs(),
    };
  }
  return {
    kind: 'status',
    nextStatus: input?.status ?? record.status,
    ...(summary ? { summary } : {}),
  };
}

function normalizeAgentEventData(
  data: AgentEventData | undefined,
  category: AgentEventCategory,
  event: Pick<AgentEvent, 'record' | 'type' | 'message' | 'status'> & Partial<Pick<AgentEvent, 'toolName' | 'filePath'>>,
): AgentEventData {
  if (data) return redactEventData(data) ?? defaultEventData(event.record, event.type, category, event.message);
  return defaultEventData(event.record, event.type, category, event.message, {
    type: event.type,
    category,
    status: event.status,
    message: event.message,
    toolName: event.toolName,
    filePath: event.filePath,
  });
}

export type NormalizedEventPatch =
  Omit<AgentEvent, 'id' | 'runId' | 'ts' | 'record' | 'status'> &
  Partial<Pick<AgentEvent, 'status'>>;

export function normalizeEventPatch(record: AgentRunRecord, input: AppendAgentEventInput): NormalizedEventPatch {
  const category = normalizeEventCategory(input.category, input.type);
  const status = input.status ?? record.status;
  const message = input.message !== undefined ? truncateSummary(input.message) : undefined;
  const legacyInput = {
    toolName: input.toolName,
    filePath: input.filePath,
    status,
    message,
  };
  return {
    type: input.type,
    category,
    ...(input.status ? { status } : {}),
    ...(message !== undefined ? { message } : {}),
    data: input.data
      ? redactEventData(input.data) ?? defaultEventData(record, input.type, category, message, legacyInput)
      : defaultEventData(record, input.type, category, message, legacyInput),
    ...(input.title ? { title: truncateSummary(input.title) } : {}),
    ...(input.toolCallId ? { toolCallId: truncateSummary(input.toolCallId) } : {}),
    ...(input.toolName ? { toolName: truncateSummary(input.toolName) } : {}),
    ...(input.filePath ? { filePath: truncateSummary(input.filePath) } : {}),
    ...(input.runtime ? { runtime: truncateSummary(input.runtime) } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.metadata ? { metadata: redactMetadata(input.metadata) } : {}),
  };
}
