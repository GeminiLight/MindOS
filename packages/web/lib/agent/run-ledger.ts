import fs from 'fs';
import path from 'path';
import { effectiveMindRoot } from '../mind-root';
import { resolveExistingSafe } from '../core/security';
import { getCurrentAgentRunContext } from './agent-run-context';
import { redactSensitiveObject, redactSensitiveText } from './redaction';

export type AgentNodeKind =
  | 'mindos-main'
  | 'mindos-headless'
  | 'native-runtime'
  | 'pi-subagent'
  | 'acp'
  | 'a2a';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out';

export type AgentRunPermissionMode = 'readonly' | 'organize' | 'agent';

export interface AgentRunRecord {
  id: string;
  rootRunId?: string;
  parentRunId?: string;
  chatSessionId?: string;
  agentKind: AgentNodeKind;
  runtimeId: string;
  displayName: string;
  status: AgentRunStatus;
  cwd?: string;
  permissionMode: AgentRunPermissionMode;
  inputSummary: string;
  outputSummary?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export type AgentEventType =
  | 'run_started'
  | 'run_updated'
  | 'run_completed'
  | 'run_failed'
  | 'run_canceled'
  | 'status'
  | 'text'
  | 'tool'
  | 'tool_started'
  | 'tool_updated'
  | 'tool_completed'
  | 'file'
  | 'file_changed'
  | 'permission'
  | 'permission_requested'
  | 'permission_resolved'
  | 'user_question_started'
  | 'user_question_resolved'
  | 'runtime_status'
  | 'error';

export type AgentEventVisibility = 'timeline' | 'debug';
export type AgentEventCategory =
  | 'status'
  | 'text'
  | 'tool'
  | 'file'
  | 'permission'
  | 'question'
  | 'error';

export type AgentEventData =
  | {
      kind: 'status';
      previousStatus?: AgentRunStatus;
      nextStatus: AgentRunStatus;
      summary?: string;
    }
  | {
      kind: 'text';
      text: string;
      channel?: 'assistant' | 'reasoning' | 'stdout' | 'stderr' | 'system';
    }
  | {
      kind: 'tool';
      name: string;
      status?: 'started' | 'running' | 'completed' | 'failed' | 'canceled';
      inputSummary?: string;
      outputSummary?: string;
      error?: string;
    }
  | {
      kind: 'file';
      path: string;
      action: 'read' | 'created' | 'updated' | 'deleted' | 'renamed' | 'diff' | 'unknown';
      status?: 'started' | 'completed' | 'failed';
      summary?: string;
    }
  | {
      kind: 'permission';
      action: string;
      status: 'requested' | 'approved' | 'denied' | 'expired' | 'skipped';
      resource?: string;
      prompt?: string;
    }
  | {
      kind: 'question';
      status: 'requested' | 'answered' | 'cancelled';
      prompt?: string;
      summary?: string;
    }
  | {
      kind: 'error';
      message: string;
      code?: string;
      recoverable?: boolean;
    };

export interface AppendAgentEventInput {
  type: AgentEventType;
  status?: AgentRunStatus;
  message?: unknown;
  category?: AgentEventCategory;
  data?: AgentEventData;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  filePath?: string;
  runtime?: string;
  visibility?: AgentEventVisibility;
  metadata?: Record<string, unknown>;
}

export interface AgentEvent {
  id: string;
  runId: string;
  type: AgentEventType;
  category: AgentEventCategory;
  ts: number;
  status: AgentRunStatus;
  record: AgentRunRecord;
  message?: string;
  data?: AgentEventData;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  filePath?: string;
  runtime?: string;
  visibility?: AgentEventVisibility;
  metadata?: Record<string, unknown>;
}

export interface StartAgentRunInput {
  id?: string;
  rootRunId?: string;
  parentRunId?: string;
  chatSessionId?: string;
  agentKind: AgentNodeKind;
  runtimeId: string;
  displayName: string;
  status?: Extract<AgentRunStatus, 'queued' | 'running' | 'streaming'>;
  cwd?: string;
  permissionMode?: AgentRunPermissionMode;
  inputSummary: string;
  metadata?: Record<string, unknown>;
}

export interface CompleteAgentRunInput {
  outputSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface FailAgentRunInput {
  error: unknown;
  outputSummary?: string;
  status?: Extract<AgentRunStatus, 'failed' | 'canceled' | 'timed_out'>;
  metadata?: Record<string, unknown>;
}

export interface CancelAgentRunInput {
  reason?: unknown;
  outputSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentRunInput {
  displayName?: string;
  runtimeId?: string;
  cwd?: string;
  permissionMode?: AgentRunPermissionMode;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  status?: AgentRunStatus;
  metadata?: Record<string, unknown>;
}

export interface ListAgentRunsOptions {
  runId?: string;
  rootRunId?: string;
  kind?: AgentNodeKind;
  status?: AgentRunStatus;
  parentRunId?: string;
  chatSessionId?: string;
  startedAfter?: number;
  limit?: number;
}

export interface ListAgentEventsOptions {
  runId?: string;
  rootRunId?: string;
  chatSessionId?: string;
  type?: AgentEventType;
  category?: AgentEventCategory;
  startedAfter?: number;
  limit?: number;
}

type AgentRunLedgerStore = {
  records: AgentRunRecord[];
  events: AgentEvent[];
  mindRoot?: string;
};

export type AgentRunEventSubscriber = (event: AgentEvent) => void;

const LEDGER_STORE_KEY = Symbol.for('mindos.agentRunLedger');
const LEDGER_SUBSCRIBERS_KEY = Symbol.for('mindos.agentRunLedger.subscribers');
const MAX_RUNS = 500;
const MAX_EVENTS = 1000;
const MAX_SUMMARY_CHARS = 4000;
const MAX_LEDGER_LOG_BYTES = 1024 * 1024;
const LEDGER_DIR_NAME = '.mindos';
const LEDGER_LEGACY_FILE_NAME = 'agent-run-ledger.json';
const LEDGER_LOG_FILE_NAME = 'agent-run-ledger.jsonl';

interface PersistedAgentRunLedger {
  version: 1;
  records: AgentRunRecord[];
  events: AgentEvent[];
}

type PersistedAgentRunLedgerOperation =
  | { version: 2; type: 'compact'; records: AgentRunRecord[]; events: AgentEvent[] }
  | { version: 2; type: 'record_upsert'; record: AgentRunRecord }
  | { version: 2; type: 'event_append'; event: AgentEvent }
  | { version: 2; type: 'reset' };

function emptyStore(mindRoot?: string): AgentRunLedgerStore {
  return { records: [], events: [], ...(mindRoot ? { mindRoot } : {}) };
}

function resolveLedgerRoot(): string | undefined {
  try {
    const root = effectiveMindRoot();
    return typeof root === 'string' && root.trim() ? root : undefined;
  } catch {
    return undefined;
  }
}

function ledgerLogPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, path.posix.join(LEDGER_DIR_NAME, LEDGER_LOG_FILE_NAME));
}

function legacyLedgerPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, path.posix.join(LEDGER_DIR_NAME, LEDGER_LEGACY_FILE_NAME));
}

function normalizeRecord(value: unknown): AgentRunRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AgentRunRecord>;
  if (typeof record.id !== 'string' || typeof record.runtimeId !== 'string' || typeof record.displayName !== 'string') return null;
  if (typeof record.startedAt !== 'number' || typeof record.inputSummary !== 'string') return null;
  if (!record.agentKind || !record.status || !record.permissionMode) return null;
  return record as AgentRunRecord;
}

function normalizeEvent(value: unknown): AgentEvent | null {
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

function normalizeEventCategory(value: unknown, type: AgentEventType): AgentEventCategory {
  if (value === 'status' || value === 'text' || value === 'tool' || value === 'file' || value === 'permission' || value === 'question' || value === 'error') {
    return value;
  }
  if (type === 'text') return 'text';
  if (type === 'tool_started' || type === 'tool_updated' || type === 'tool_completed') return 'tool';
  if (type === 'file_changed') return 'file';
  if (type === 'permission_requested' || type === 'permission_resolved') return 'permission';
  if (type === 'user_question_started' || type === 'user_question_resolved') return 'question';
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

type NormalizedEventPatch =
  Omit<AgentEvent, 'id' | 'runId' | 'ts' | 'record' | 'status'> &
  Partial<Pick<AgentEvent, 'status'>>;

function normalizeEventPatch(record: AgentRunRecord, input: AppendAgentEventInput): NormalizedEventPatch {
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

function normalizeStore(store: AgentRunLedgerStore): AgentRunLedgerStore {
  return {
    ...store,
    records: store.records.slice(0, MAX_RUNS),
    events: store.events.slice(0, MAX_EVENTS),
  };
}

function readLegacyPersistedStore(mindRoot: string): AgentRunLedgerStore {
  try {
    const file = legacyLedgerPath(mindRoot);
    if (!fs.existsSync(file)) return emptyStore(mindRoot);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<PersistedAgentRunLedger>;
    return normalizeStore({
      mindRoot,
      records: Array.isArray(parsed.records) ? parsed.records.map(normalizeRecord).filter((record): record is AgentRunRecord => Boolean(record)).slice(0, MAX_RUNS) : [],
      events: Array.isArray(parsed.events) ? parsed.events.map(normalizeEvent).filter((event): event is AgentEvent => Boolean(event)).slice(0, MAX_EVENTS) : [],
    });
  } catch {
    return emptyStore(mindRoot);
  }
}

function applyPersistedOperation(store: AgentRunLedgerStore, op: unknown): AgentRunLedgerStore {
  if (!op || typeof op !== 'object') return store;
  const operation = op as Partial<PersistedAgentRunLedgerOperation>;
  if (operation.version !== 2 || typeof operation.type !== 'string') return store;

  if (operation.type === 'reset') {
    return emptyStore(store.mindRoot);
  }

  if (operation.type === 'compact') {
    const compact = operation as Partial<Extract<PersistedAgentRunLedgerOperation, { type: 'compact' }>>;
    return normalizeStore({
      ...store,
      records: Array.isArray(compact.records) ? compact.records.map(normalizeRecord).filter((record): record is AgentRunRecord => Boolean(record)) : [],
      events: Array.isArray(compact.events) ? compact.events.map(normalizeEvent).filter((event): event is AgentEvent => Boolean(event)) : [],
    });
  }

  if (operation.type === 'record_upsert') {
    const record = normalizeRecord((operation as Partial<Extract<PersistedAgentRunLedgerOperation, { type: 'record_upsert' }>>).record);
    if (!record) return store;
    const records = store.records.filter((existing) => existing.id !== record.id);
    records.unshift(record);
    return normalizeStore({ ...store, records });
  }

  if (operation.type === 'event_append') {
    const event = normalizeEvent((operation as Partial<Extract<PersistedAgentRunLedgerOperation, { type: 'event_append' }>>).event);
    if (!event) return store;
    return normalizeStore({ ...store, events: [event, ...store.events] });
  }

  return store;
}

function writeCompactedLedger(store: AgentRunLedgerStore): void {
  if (!store.mindRoot) return;
  try {
    const file = ledgerLogPath(store.mindRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const op: PersistedAgentRunLedgerOperation = {
      version: 2,
      type: 'compact',
      records: store.records.slice(0, MAX_RUNS),
      events: store.events.slice(0, MAX_EVENTS),
    };
    fs.writeFileSync(tmp, `${JSON.stringify(op)}\n`, 'utf-8');
    fs.renameSync(tmp, file);
  } catch {
    // Ledger persistence must never affect agent execution.
  }
}

function appendPersistedOperation(store: AgentRunLedgerStore, op: PersistedAgentRunLedgerOperation): void {
  if (!store.mindRoot) return;
  try {
    const file = ledgerLogPath(store.mindRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(op)}\n`, 'utf-8');
    if (fs.statSync(file).size > MAX_LEDGER_LOG_BYTES) {
      writeCompactedLedger(store);
    }
  } catch {
    // Ledger persistence must never affect agent execution.
  }
}

function readJsonlPersistedStore(mindRoot: string): AgentRunLedgerStore | null {
  try {
    const file = ledgerLogPath(mindRoot);
    if (!fs.existsSync(file)) return null;
    let store = emptyStore(mindRoot);
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        store = applyPersistedOperation(store, JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
    return normalizeStore(store);
  } catch {
    return emptyStore(mindRoot);
  }
}

function readPersistedStore(mindRoot: string): AgentRunLedgerStore {
  const fromLog = readJsonlPersistedStore(mindRoot);
  if (fromLog) return fromLog;

  const legacy = readLegacyPersistedStore(mindRoot);
  if (legacy.records.length > 0 || legacy.events.length > 0) {
    writeCompactedLedger(legacy);
  }
  return legacy;
}

function getStore(): AgentRunLedgerStore {
  const globalStore = globalThis as typeof globalThis & { [LEDGER_STORE_KEY]?: AgentRunLedgerStore };
  const mindRoot = resolveLedgerRoot();
  if (!globalStore[LEDGER_STORE_KEY] || globalStore[LEDGER_STORE_KEY].mindRoot !== mindRoot) {
    globalStore[LEDGER_STORE_KEY] = mindRoot ? readPersistedStore(mindRoot) : emptyStore();
  }
  return globalStore[LEDGER_STORE_KEY];
}

function getSubscribers(): Set<AgentRunEventSubscriber> {
  const globalStore = globalThis as typeof globalThis & { [LEDGER_SUBSCRIBERS_KEY]?: Set<AgentRunEventSubscriber> };
  if (!globalStore[LEDGER_SUBSCRIBERS_KEY]) {
    globalStore[LEDGER_SUBSCRIBERS_KEY] = new Set();
  }
  return globalStore[LEDGER_SUBSCRIBERS_KEY];
}

function notifyAgentEventSubscribers(event: AgentEvent): void {
  for (const subscriber of Array.from(getSubscribers())) {
    try {
      subscriber(event);
    } catch {
      // Realtime observers must never affect agent execution or ledger persistence.
    }
  }
}

function nowMs(): number {
  return Date.now();
}

function createRunId(): string {
  return `agent-run-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEventId(): string {
  return `agent-event-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateSummary(value: unknown): string {
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

function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveObject(metadata) as Record<string, unknown>;
}

function normalizePermissionMode(mode: unknown): AgentRunPermissionMode {
  if (mode === 'readonly' || mode === 'chat') return 'readonly';
  if (mode === 'organize') return 'organize';
  return 'agent';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTerminalStatus(status: AgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timed_out';
}

function appendAgentEvent(record: AgentRunRecord, input: AgentEventType | AppendAgentEventInput, message?: string): AgentEvent {
  const store = getStore();
  const patch = typeof input === 'string'
    ? normalizeEventPatch(record, { type: input, category: normalizeEventCategory(undefined, input), ...(message ? { message } : {}) })
    : normalizeEventPatch(record, input);
  const event: AgentEvent = {
    id: createEventId(),
    runId: record.id,
    ...patch,
    ts: nowMs(),
    status: patch.status ?? record.status,
    record,
  };
  store.events.unshift(event);
  if (store.events.length > MAX_EVENTS) {
    store.events = store.events.slice(0, MAX_EVENTS);
  }
  appendPersistedOperation(store, { version: 2, type: 'event_append', event });
  notifyAgentEventSubscribers(event);
  return event;
}

export function appendAgentRunEvent(runId: string, input: AppendAgentEventInput): AgentEvent | undefined {
  const record = getAgentRun(runId);
  if (!record) return undefined;
  return appendAgentEvent(record, input);
}

function finishRun(
  id: string,
  patch: Pick<AgentRunRecord, 'status'> & Partial<Pick<AgentRunRecord, 'outputSummary' | 'error' | 'metadata'>>,
): AgentRunRecord | undefined {
  const store = getStore();
  const index = store.records.findIndex((record) => record.id === id);
  if (index < 0) return undefined;

  const current = store.records[index]!;
  if (isTerminalStatus(current.status)) return current;

  const completedAt = nowMs();
  const next: AgentRunRecord = {
    ...current,
    status: patch.status,
    ...(patch.outputSummary !== undefined ? { outputSummary: truncateSummary(patch.outputSummary) } : {}),
    ...(patch.error !== undefined ? { error: truncateSummary(patch.error) } : {}),
    ...(patch.metadata ? { metadata: redactMetadata({ ...(current.metadata ?? {}), ...patch.metadata }) } : {}),
    completedAt,
    durationMs: Math.max(0, completedAt - current.startedAt),
  };
  store.records[index] = next;
  appendPersistedOperation(store, { version: 2, type: 'record_upsert', record: next });
  const eventType = patch.status === 'completed'
    ? 'run_completed'
    : patch.status === 'canceled'
      ? 'run_canceled'
      : 'run_failed';
  appendAgentEvent(next, eventType, patch.error);
  return next;
}

export function startAgentRun(input: StartAgentRunInput): AgentRunRecord {
  const startedAt = nowMs();
  const context = getCurrentAgentRunContext();
  const id = input.id ?? createRunId();
  const parentRunId = input.parentRunId ?? context?.parentRunId;
  const rootRunId = input.rootRunId ?? context?.rootRunId ?? (parentRunId || id);
  const chatSessionId = input.chatSessionId ?? context?.chatSessionId;
  const record: AgentRunRecord = {
    id,
    rootRunId,
    ...(parentRunId ? { parentRunId } : {}),
    ...(chatSessionId ? { chatSessionId } : {}),
    agentKind: input.agentKind,
    runtimeId: input.runtimeId,
    displayName: input.displayName,
    status: input.status ?? 'running',
    ...(input.cwd ? { cwd: input.cwd } : {}),
    permissionMode: normalizePermissionMode(input.permissionMode),
    inputSummary: truncateSummary(input.inputSummary),
    startedAt,
    ...(input.metadata ? { metadata: redactMetadata(input.metadata) } : {}),
  };

  const store = getStore();
  store.records.unshift(record);
  if (store.records.length > MAX_RUNS) {
    store.records = store.records.slice(0, MAX_RUNS);
  }
  appendPersistedOperation(store, { version: 2, type: 'record_upsert', record });
  appendAgentEvent(record, 'run_started');
  return record;
}

export function updateAgentRun(id: string, input: UpdateAgentRunInput): AgentRunRecord | undefined {
  const store = getStore();
  const index = store.records.findIndex((record) => record.id === id);
  if (index < 0) return undefined;

  const current = store.records[index]!;
  const next: AgentRunRecord = {
    ...current,
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.runtimeId !== undefined ? { runtimeId: input.runtimeId } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.permissionMode !== undefined ? { permissionMode: normalizePermissionMode(input.permissionMode) } : {}),
    ...(input.inputSummary !== undefined ? { inputSummary: truncateSummary(input.inputSummary) } : {}),
    ...(input.outputSummary !== undefined ? { outputSummary: truncateSummary(input.outputSummary) } : {}),
    ...(input.error !== undefined ? { error: truncateSummary(input.error) } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.metadata ? { metadata: redactMetadata({ ...(current.metadata ?? {}), ...input.metadata }) } : {}),
  };
  store.records[index] = next;
  appendPersistedOperation(store, { version: 2, type: 'record_upsert', record: next });
  appendAgentEvent(next, 'run_updated', input.error ?? input.outputSummary);
  return next;
}

export function completeAgentRun(id: string, input: CompleteAgentRunInput = {}): AgentRunRecord | undefined {
  return finishRun(id, {
    status: 'completed',
    outputSummary: input.outputSummary,
    metadata: input.metadata,
  });
}

export function failAgentRun(id: string, input: FailAgentRunInput): AgentRunRecord | undefined {
  return finishRun(id, {
    status: input.status ?? 'failed',
    outputSummary: input.outputSummary,
    error: errorMessage(input.error),
    metadata: input.metadata,
  });
}

export function cancelAgentRun(id: string, input: CancelAgentRunInput = {}): AgentRunRecord | undefined {
  return finishRun(id, {
    status: 'canceled',
    outputSummary: input.outputSummary,
    error: errorMessage(input.reason ?? 'Agent run was canceled.'),
    metadata: input.metadata,
  });
}

export function getAgentRun(id: string): AgentRunRecord | undefined {
  return getStore().records.find((record) => record.id === id);
}

export function listAgentRuns(options: ListAgentRunsOptions = {}): AgentRunRecord[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, MAX_RUNS));
  return getStore().records
    .filter((record) => !options.runId || record.id === options.runId)
    .filter((record) => !options.rootRunId || record.rootRunId === options.rootRunId || record.id === options.rootRunId)
    .filter((record) => !options.kind || record.agentKind === options.kind)
    .filter((record) => !options.status || record.status === options.status)
    .filter((record) => !options.parentRunId || record.parentRunId === options.parentRunId)
    .filter((record) => !options.chatSessionId || record.chatSessionId === options.chatSessionId)
    .filter((record) => options.startedAfter === undefined || record.startedAt >= options.startedAfter)
    .slice(0, limit);
}

export function listAgentEvents(options: ListAgentEventsOptions = {}): AgentEvent[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, MAX_EVENTS));
  return getStore().events
    .filter((event) => !options.runId || event.runId === options.runId)
    .filter((event) => !options.rootRunId || event.record.rootRunId === options.rootRunId || event.record.id === options.rootRunId)
    .filter((event) => !options.chatSessionId || event.record.chatSessionId === options.chatSessionId)
    .filter((event) => !options.type || event.type === options.type)
    .filter((event) => !options.category || event.category === options.category)
    .filter((event) => options.startedAfter === undefined || event.ts >= options.startedAfter || event.record.startedAt >= options.startedAfter)
    .slice(0, limit);
}

export function subscribeAgentRunEvents(subscriber: AgentRunEventSubscriber): () => void {
  const subscribers = getSubscribers();
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetAgentRunsForTest(): void {
  const store = getStore();
  store.records = [];
  store.events = [];
  appendPersistedOperation(store, { version: 2, type: 'reset' });
  writeCompactedLedger(store);
}

export function coerceAgentRunPermissionMode(mode: unknown): AgentRunPermissionMode {
  return normalizePermissionMode(mode);
}

export function reloadAgentRunsFromDiskForTest(): void {
  const globalStore = globalThis as typeof globalThis & { [LEDGER_STORE_KEY]?: AgentRunLedgerStore };
  delete globalStore[LEDGER_STORE_KEY];
}
