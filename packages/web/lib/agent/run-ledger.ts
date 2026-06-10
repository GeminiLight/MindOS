import fs from 'fs';
import path from 'path';
import { effectiveMindRoot } from '../mind-root';
import { resolveExistingSafe } from '../core/security';
import { getCurrentAgentRunContext } from './agent-run-context';

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
  | 'run_failed';

export interface AgentEvent {
  id: string;
  runId: string;
  type: AgentEventType;
  ts: number;
  status: AgentRunStatus;
  record: AgentRunRecord;
  message?: string;
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
  limit?: number;
}

type AgentRunLedgerStore = {
  records: AgentRunRecord[];
  events: AgentEvent[];
  mindRoot?: string;
};

const LEDGER_STORE_KEY = Symbol.for('mindos.agentRunLedger');
const MAX_RUNS = 500;
const MAX_EVENTS = 1000;
const MAX_SUMMARY_CHARS = 4000;
const LEDGER_DIR_NAME = '.mindos';
const LEDGER_FILE_NAME = 'agent-run-ledger.json';

interface PersistedAgentRunLedger {
  version: 1;
  records: AgentRunRecord[];
  events: AgentEvent[];
}

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

function ledgerPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, path.posix.join(LEDGER_DIR_NAME, LEDGER_FILE_NAME));
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
  return event as AgentEvent;
}

function readPersistedStore(mindRoot: string): AgentRunLedgerStore {
  try {
    const file = ledgerPath(mindRoot);
    if (!fs.existsSync(file)) return emptyStore(mindRoot);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<PersistedAgentRunLedger>;
    return {
      mindRoot,
      records: Array.isArray(parsed.records) ? parsed.records.map(normalizeRecord).filter((record): record is AgentRunRecord => Boolean(record)).slice(0, MAX_RUNS) : [],
      events: Array.isArray(parsed.events) ? parsed.events.map(normalizeEvent).filter((event): event is AgentEvent => Boolean(event)).slice(0, MAX_EVENTS) : [],
    };
  } catch {
    return emptyStore(mindRoot);
  }
}

function writePersistedStore(store: AgentRunLedgerStore): void {
  if (!store.mindRoot) return;
  try {
    const file = ledgerPath(store.mindRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const state: PersistedAgentRunLedger = {
      version: 1,
      records: store.records.slice(0, MAX_RUNS),
      events: store.events.slice(0, MAX_EVENTS),
    };
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch {
    // Ledger persistence must never affect agent execution.
  }
}

function getStore(): AgentRunLedgerStore {
  const globalStore = globalThis as typeof globalThis & { [LEDGER_STORE_KEY]?: AgentRunLedgerStore };
  const mindRoot = resolveLedgerRoot();
  if (!globalStore[LEDGER_STORE_KEY] || globalStore[LEDGER_STORE_KEY].mindRoot !== mindRoot) {
    globalStore[LEDGER_STORE_KEY] = mindRoot ? readPersistedStore(mindRoot) : emptyStore();
  }
  return globalStore[LEDGER_STORE_KEY];
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
    return value.length > MAX_SUMMARY_CHARS ? `${value.slice(0, MAX_SUMMARY_CHARS)}...` : value;
  }
  if (value == null) return '';
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > MAX_SUMMARY_CHARS ? `${serialized.slice(0, MAX_SUMMARY_CHARS)}...` : serialized;
  } catch {
    return String(value);
  }
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

function appendAgentEvent(record: AgentRunRecord, type: AgentEventType, message?: string): AgentEvent {
  const store = getStore();
  const event: AgentEvent = {
    id: createEventId(),
    runId: record.id,
    type,
    ts: nowMs(),
    status: record.status,
    record,
    ...(message ? { message: truncateSummary(message) } : {}),
  };
  store.events.unshift(event);
  if (store.events.length > MAX_EVENTS) {
    store.events = store.events.slice(0, MAX_EVENTS);
  }
  writePersistedStore(store);
  return event;
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
    ...(patch.metadata ? { metadata: { ...(current.metadata ?? {}), ...patch.metadata } } : {}),
    completedAt,
    durationMs: Math.max(0, completedAt - current.startedAt),
  };
  store.records[index] = next;
  appendAgentEvent(next, patch.status === 'completed' ? 'run_completed' : 'run_failed', patch.error);
  writePersistedStore(store);
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
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  const store = getStore();
  store.records.unshift(record);
  if (store.records.length > MAX_RUNS) {
    store.records = store.records.slice(0, MAX_RUNS);
  }
  appendAgentEvent(record, 'run_started');
  writePersistedStore(store);
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
    ...(input.metadata ? { metadata: { ...(current.metadata ?? {}), ...input.metadata } } : {}),
  };
  store.records[index] = next;
  appendAgentEvent(next, 'run_updated', input.error);
  writePersistedStore(store);
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
    .slice(0, limit);
}

export function resetAgentRunsForTest(): void {
  const store = getStore();
  store.records = [];
  store.events = [];
  writePersistedStore(store);
}

export function coerceAgentRunPermissionMode(mode: unknown): AgentRunPermissionMode {
  return normalizePermissionMode(mode);
}

export function reloadAgentRunsFromDiskForTest(): void {
  const globalStore = globalThis as typeof globalThis & { [LEDGER_STORE_KEY]?: AgentRunLedgerStore };
  delete globalStore[LEDGER_STORE_KEY];
}
