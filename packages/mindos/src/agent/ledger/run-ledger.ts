import fs from 'node:fs';
import path from 'node:path';
import { effectiveMindRoot } from '../../foundation/mind-root/index.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { getCurrentAgentRunContext } from '../agent-run-context.js';
import {
  AGENT_RUN_LEDGER_SHARD_KEY,
  AGENT_RUN_LEDGER_STORE_KEY,
  AGENT_RUN_LEDGER_SUBSCRIBERS_KEY,
  deleteProcessGlobal,
  getProcessGlobal,
} from '../global-state.js';
import { readLegacyMindosPermissionMode } from '../permission/index.js';
import { redactSensitiveObject, redactSensitiveText } from '../redaction.js';

/**
 * Cross-runtime agent run ledger — an INDEX CARD store, not a transcript
 * store (spec-agent-core-consolidation B.1/C).
 *
 * Each runtime keeps its own full archive (Claude Code: ~/.claude, Codex:
 * ~/.codex, embedded Pi: SessionManager archive when session-bound). The ledger
 * persists only run records — id / kind / status / parent-child links /
 * timestamps / capped summaries / an `archive` pointer into the runtime's
 * own archive. Fine-grained timeline events still flow through the in-memory
 * store and realtime subscribers for live UI, but are NOT written to disk;
 * after a restart the UI can list runs and their terminal state (the ledger's
 * minimal crash-survival contract), not replay old timelines.
 *
 * Persistence model — one shard per process, no shared writers:
 *   <mindRoot>/.mindos/agent-run-ledger.<pid>-<startTs>.jsonl
 * Reads scan the directory and merge every shard plus the two legacy files
 * (agent-run-ledger.json v1, agent-run-ledger.jsonl v2), which are read-only
 * and never written again. Compaction rewrites ONLY this process's shard —
 * single writer per file, so no cross-process locking exists or is needed.
 * Nothing in this module may rewrite a file another process wrote.
 */

export * from './run-ledger-types.js';
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
  CancelAgentRunInput,
  CompleteAgentRunInput,
  FailAgentRunInput,
  ListAgentEventsOptions,
  ListAgentRunsOptions,
  StartAgentRunInput,
  UpdateAgentRunInput,
} from './run-ledger-types.js';

type AgentRunLedgerStore = {
  records: AgentRunRecord[];
  /** Live timeline, in-memory only — see module header. */
  events: AgentEvent[];
  mindRoot?: string;
  /** Run ids this process has persisted; compaction writes exactly these. */
  ownRecordIds: Set<string>;
};

export type AgentRunEventSubscriber = (event: AgentEvent) => void;

const MAX_RUNS = 500;
const MAX_EVENTS = 1000;
const MAX_SUMMARY_CHARS = 4000;
const MAX_SHARD_LOG_BYTES = 1024 * 1024;
const LEDGER_DIR_NAME = '.mindos';
const LEDGER_LEGACY_JSON_NAME = 'agent-run-ledger.json';
const LEDGER_LEGACY_JSONL_NAME = 'agent-run-ledger.jsonl';
const SHARD_FILE_PATTERN = /^agent-run-ledger\.(\d+)-(\d+)\.jsonl$/;

interface LegacyPersistedAgentRunLedger {
  version: 1;
  records: AgentRunRecord[];
  events: AgentEvent[];
}

/** v2 ops only ever appear in the legacy global JSONL (read-only). */
type LegacyPersistedOperation =
  | { version: 2; type: 'compact'; records: AgentRunRecord[]; events: AgentEvent[] }
  | { version: 2; type: 'record_upsert'; record: AgentRunRecord }
  | { version: 2; type: 'event_append'; event: AgentEvent }
  | { version: 2; type: 'reset' };

type ShardOperation =
  | { version: 3; type: 'record_upsert'; ts: number; record: AgentRunRecord }
  | { version: 3; type: 'compact'; ts: number; records: AgentRunRecord[] };

/** A record merged from disk, tagged with where and when it was written. */
type MergedRecordEntry = {
  record: AgentRunRecord;
  ts: number;
  /** null = legacy global file (no owning process is alive for it). */
  shard: { pid: number; startTs: number } | null;
};

type ShardIdentity = { pid: number; startTs: number };

function shardIdentity(): ShardIdentity {
  return getProcessGlobal(AGENT_RUN_LEDGER_SHARD_KEY, () => ({
    pid: process.pid,
    // performance.timeOrigin is identical for every module copy in the
    // process, unlike a Date.now() captured at each copy's load time.
    startTs: Math.round(performance.timeOrigin),
  }));
}

function emptyStore(mindRoot?: string): AgentRunLedgerStore {
  return { records: [], events: [], ownRecordIds: new Set(), ...(mindRoot ? { mindRoot } : {}) };
}

function resolveLedgerRoot(): string | undefined {
  try {
    const root = effectiveMindRoot();
    return typeof root === 'string' && root.trim() ? root : undefined;
  } catch {
    return undefined;
  }
}

function ledgerDirPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, LEDGER_DIR_NAME);
}

function ownShardPath(mindRoot: string): string {
  const { pid, startTs } = shardIdentity();
  return resolveExistingSafe(
    mindRoot,
    path.posix.join(LEDGER_DIR_NAME, `agent-run-ledger.${pid}-${startTs}.jsonl`),
  );
}

function legacyJsonPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, path.posix.join(LEDGER_DIR_NAME, LEDGER_LEGACY_JSON_NAME));
}

function legacyJsonlPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, path.posix.join(LEDGER_DIR_NAME, LEDGER_LEGACY_JSONL_NAME));
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

// --- disk: legacy readers (read-only, never written again) ---

function recordWriteTs(record: AgentRunRecord): number {
  return record.completedAt ?? record.startedAt;
}

function mergeLegacyJson(mindRoot: string, merged: Map<string, MergedRecordEntry>, events: AgentEvent[]): void {
  try {
    const file = legacyJsonPath(mindRoot);
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<LegacyPersistedAgentRunLedger>;
    for (const value of Array.isArray(parsed.records) ? parsed.records : []) {
      const record = normalizeRecord(value);
      if (record) mergeRecordEntry(merged, { record, ts: recordWriteTs(record), shard: null });
    }
    for (const value of Array.isArray(parsed.events) ? parsed.events : []) {
      const event = normalizeEvent(value);
      if (event) events.push(event);
    }
  } catch {
    // Unreadable legacy data must never block the ledger.
  }
}

function mergeLegacyJsonl(mindRoot: string, merged: Map<string, MergedRecordEntry>, events: AgentEvent[]): void {
  try {
    const file = legacyJsonlPath(mindRoot);
    if (!fs.existsSync(file)) return;
    // Replay the v2 op log into a local view first — later ops override
    // earlier ones within the file, independent of cross-shard merge order.
    const local = new Map<string, AgentRunRecord>();
    const localEvents: AgentEvent[] = [];
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let op: Partial<LegacyPersistedOperation>;
      try { op = JSON.parse(trimmed) as Partial<LegacyPersistedOperation>; } catch { continue; }
      if (op.version !== 2 || typeof op.type !== 'string') continue;
      if (op.type === 'reset') { local.clear(); localEvents.length = 0; continue; }
      if (op.type === 'compact') {
        local.clear();
        localEvents.length = 0;
        const compact = op as Partial<Extract<LegacyPersistedOperation, { type: 'compact' }>>;
        for (const value of Array.isArray(compact.records) ? compact.records : []) {
          const record = normalizeRecord(value);
          if (record) local.set(record.id, record);
        }
        for (const value of Array.isArray(compact.events) ? compact.events : []) {
          const event = normalizeEvent(value);
          if (event) localEvents.push(event);
        }
        continue;
      }
      if (op.type === 'record_upsert') {
        const record = normalizeRecord((op as Partial<Extract<LegacyPersistedOperation, { type: 'record_upsert' }>>).record);
        if (record) local.set(record.id, record);
        continue;
      }
      if (op.type === 'event_append') {
        const event = normalizeEvent((op as Partial<Extract<LegacyPersistedOperation, { type: 'event_append' }>>).event);
        if (event) localEvents.push(event);
      }
    }
    for (const record of local.values()) {
      mergeRecordEntry(merged, { record, ts: recordWriteTs(record), shard: null });
    }
    events.push(...localEvents);
  } catch {
    // Unreadable legacy data must never block the ledger.
  }
}

// --- disk: shard readers + merge ---

function listShardFiles(mindRoot: string): Array<{ file: string; pid: number; startTs: number }> {
  try {
    const dir = ledgerDirPath(mindRoot);
    if (!fs.existsSync(dir)) return [];
    const shards: Array<{ file: string; pid: number; startTs: number }> = [];
    for (const name of fs.readdirSync(dir)) {
      const match = SHARD_FILE_PATTERN.exec(name);
      if (!match) continue;
      shards.push({ file: path.join(dir, name), pid: Number(match[1]), startTs: Number(match[2]) });
    }
    // Deterministic merge order so every reader resolves ties identically.
    return shards.sort((a, b) => (a.startTs - b.startTs) || (a.pid - b.pid));
  } catch {
    return [];
  }
}

const conflictWarnedRunIds = new Set<string>();

function mergeRecordEntry(merged: Map<string, MergedRecordEntry>, entry: MergedRecordEntry): void {
  const existing = merged.get(entry.record.id);
  if (!existing) {
    merged.set(entry.record.id, entry);
    return;
  }
  // Same run id written from two places (spec edge case: cross-process id
  // collision). Runs are owned by the creating process; resolve
  // last-write-wins by timestamp and surface the anomaly once.
  const differentWriter = existing.shard?.pid !== entry.shard?.pid || existing.shard?.startTs !== entry.shard?.startTs;
  if (differentWriter && !conflictWarnedRunIds.has(entry.record.id)) {
    conflictWarnedRunIds.add(entry.record.id);
    console.warn(`[mindos] agent run ledger: run id ${entry.record.id} appears in multiple ledger sources; keeping the most recent write.`);
  }
  if (entry.ts >= existing.ts) merged.set(entry.record.id, entry);
}

function mergeShard(shard: { file: string; pid: number; startTs: number }, merged: Map<string, MergedRecordEntry>): void {
  try {
    if (!fs.existsSync(shard.file)) return;
    const local = new Map<string, { record: AgentRunRecord; ts: number }>();
    for (const line of fs.readFileSync(shard.file, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let op: Partial<ShardOperation>;
      try { op = JSON.parse(trimmed) as Partial<ShardOperation>; } catch { continue; }
      if (op.version !== 3 || typeof op.type !== 'string') continue;
      if (op.type === 'compact') {
        local.clear();
        const compact = op as Partial<Extract<ShardOperation, { type: 'compact' }>>;
        for (const value of Array.isArray(compact.records) ? compact.records : []) {
          const record = normalizeRecord(value);
          if (record) local.set(record.id, { record, ts: typeof op.ts === 'number' ? op.ts : recordWriteTs(record) });
        }
        continue;
      }
      if (op.type === 'record_upsert') {
        const record = normalizeRecord((op as Partial<Extract<ShardOperation, { type: 'record_upsert' }>>).record);
        if (record) local.set(record.id, { record, ts: typeof op.ts === 'number' ? op.ts : recordWriteTs(record) });
      }
    }
    for (const { record, ts } of local.values()) {
      mergeRecordEntry(merged, { record, ts, shard: { pid: shard.pid, startTs: shard.startTs } });
    }
  } catch {
    // A torn or unreadable shard must never block the ledger.
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = exists but owned by another user; anything else (ESRCH) = gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isDeadWriter(entry: MergedRecordEntry): boolean {
  // Legacy global files have no owning process — since the migration, no live
  // process appends to them, so a non-terminal record there can never
  // progress again.
  if (!entry.shard) return true;
  const self = shardIdentity();
  if (entry.shard.pid === self.pid) {
    // Same pid but a different start timestamp is a previous incarnation of
    // a recycled pid — that writer is gone even though the pid looks alive.
    return entry.shard.startTs !== self.startTs;
  }
  return !isPidAlive(entry.shard.pid);
}

/**
 * Orphaned runs: the owning process died before reaching a terminal status.
 * Marked failed at merge time, in memory only — the shard stays untouched on
 * disk for audit, and every reader computes the same result.
 */
function markOrphanedRun(record: AgentRunRecord): AgentRunRecord {
  return {
    ...record,
    status: 'failed',
    error: record.error ?? 'MindOS process that owned this run exited before it finished.',
    metadata: { ...(record.metadata ?? {}), failureReason: 'process-died' },
  };
}

function readPersistedStore(mindRoot: string): AgentRunLedgerStore {
  const merged = new Map<string, MergedRecordEntry>();
  const events: AgentEvent[] = [];
  mergeLegacyJson(mindRoot, merged, events);
  mergeLegacyJsonl(mindRoot, merged, events);
  const self = shardIdentity();
  const ownRecordIds = new Set<string>();
  for (const shard of listShardFiles(mindRoot)) {
    mergeShard(shard, merged);
  }

  const records: AgentRunRecord[] = [];
  for (const entry of merged.values()) {
    const ownedBySelf = entry.shard?.pid === self.pid && entry.shard?.startTs === self.startTs;
    if (ownedBySelf) ownRecordIds.add(entry.record.id);
    if (!isTerminalStatus(entry.record.status) && !ownedBySelf && isDeadWriter(entry)) {
      records.push(markOrphanedRun(entry.record));
    } else {
      records.push(entry.record);
    }
  }
  records.sort((a, b) => b.startedAt - a.startedAt);
  events.sort((a, b) => b.ts - a.ts);

  return {
    mindRoot,
    records: records.slice(0, MAX_RUNS),
    events: events.slice(0, MAX_EVENTS),
    ownRecordIds,
  };
}

// --- disk: own-shard writer (the ONLY writes this module performs) ---

function appendOwnShardOperation(store: AgentRunLedgerStore, record: AgentRunRecord): void {
  if (!store.mindRoot) return;
  try {
    const file = ownShardPath(store.mindRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const op: ShardOperation = { version: 3, type: 'record_upsert', ts: nowMs(), record };
    fs.appendFileSync(file, `${JSON.stringify(op)}\n`, 'utf-8');
    store.ownRecordIds.add(record.id);
    if (fs.statSync(file).size > MAX_SHARD_LOG_BYTES) {
      compactOwnShard(store);
    }
  } catch {
    // Ledger persistence must never affect agent execution.
  }
}

function compactOwnShard(store: AgentRunLedgerStore): void {
  if (!store.mindRoot) return;
  try {
    const file = ownShardPath(store.mindRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // This process is the shard's single writer, so the in-memory view of its
    // OWN records is authoritative — foreign records live in foreign shards
    // and are deliberately not written here.
    const op: ShardOperation = {
      version: 3,
      type: 'compact',
      ts: nowMs(),
      records: store.records.filter((record) => store.ownRecordIds.has(record.id)).slice(0, MAX_RUNS),
    };
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(op)}\n`, 'utf-8');
    fs.renameSync(tmp, file);
  } catch {
    // Ledger persistence must never affect agent execution.
  }
}

// --- in-memory store + subscribers ---

function getStore(): AgentRunLedgerStore {
  const mindRoot = resolveLedgerRoot();
  const store = getProcessGlobal<AgentRunLedgerStore>(
    AGENT_RUN_LEDGER_STORE_KEY,
    () => (mindRoot ? readPersistedStore(mindRoot) : emptyStore()),
  );
  if (store.mindRoot !== mindRoot) {
    deleteProcessGlobal(AGENT_RUN_LEDGER_STORE_KEY);
    return getProcessGlobal<AgentRunLedgerStore>(
      AGENT_RUN_LEDGER_STORE_KEY,
      () => (mindRoot ? readPersistedStore(mindRoot) : emptyStore()),
    );
  }
  return store;
}

function getSubscribers(): Set<AgentRunEventSubscriber> {
  return getProcessGlobal(AGENT_RUN_LEDGER_SUBSCRIBERS_KEY, () => new Set<AgentRunEventSubscriber>());
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
  return readLegacyMindosPermissionMode(mode);
}

function normalizeArchiveRef(value: AgentRunArchiveRef | undefined): AgentRunArchiveRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const archive: AgentRunArchiveRef = {};
  if (typeof value.sessionId === 'string' && value.sessionId.trim()) archive.sessionId = truncateSummary(value.sessionId);
  if (typeof value.path === 'string' && value.path.trim()) archive.path = truncateSummary(value.path);
  return Object.keys(archive).length > 0 ? archive : undefined;
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
  patch: Pick<AgentRunRecord, 'status'> & Partial<Pick<AgentRunRecord, 'outputSummary' | 'error' | 'metadata' | 'archive'>>,
): AgentRunRecord | undefined {
  const store = getStore();
  const index = store.records.findIndex((record) => record.id === id);
  if (index < 0) return undefined;

  const current = store.records[index]!;
  if (isTerminalStatus(current.status)) return current;

  const archivePatch = normalizeArchiveRef(patch.archive);
  const completedAt = nowMs();
  const next: AgentRunRecord = {
    ...current,
    status: patch.status,
    ...(patch.outputSummary !== undefined ? { outputSummary: truncateSummary(patch.outputSummary) } : {}),
    ...(patch.error !== undefined ? { error: truncateSummary(patch.error) } : {}),
    ...(patch.metadata ? { metadata: redactMetadata({ ...(current.metadata ?? {}), ...patch.metadata }) } : {}),
    ...(archivePatch ? { archive: { ...(current.archive ?? {}), ...archivePatch } } : {}),
    completedAt,
    durationMs: Math.max(0, completedAt - current.startedAt),
  };
  store.records[index] = next;
  appendOwnShardOperation(store, next);
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
  const archive = normalizeArchiveRef(input.archive);
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
    ...(archive ? { archive } : {}),
    ...(input.metadata ? { metadata: redactMetadata(input.metadata) } : {}),
  };

  const store = getStore();
  store.records.unshift(record);
  if (store.records.length > MAX_RUNS) {
    store.records = store.records.slice(0, MAX_RUNS);
  }
  appendOwnShardOperation(store, record);
  appendAgentEvent(record, 'run_started');
  return record;
}

export function updateAgentRun(id: string, input: UpdateAgentRunInput): AgentRunRecord | undefined {
  const store = getStore();
  const index = store.records.findIndex((record) => record.id === id);
  if (index < 0) return undefined;

  const current = store.records[index]!;
  const archivePatch = normalizeArchiveRef(input.archive);
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
    ...(archivePatch ? { archive: { ...(current.archive ?? {}), ...archivePatch } } : {}),
    ...(input.metadata ? { metadata: redactMetadata({ ...(current.metadata ?? {}), ...input.metadata }) } : {}),
  };
  store.records[index] = next;
  appendOwnShardOperation(store, next);
  appendAgentEvent(next, 'run_updated', input.error ?? input.outputSummary);
  return next;
}

export function completeAgentRun(id: string, input: CompleteAgentRunInput = {}): AgentRunRecord | undefined {
  return finishRun(id, {
    status: 'completed',
    outputSummary: input.outputSummary,
    archive: input.archive,
    metadata: input.metadata,
  });
}

export function failAgentRun(id: string, input: FailAgentRunInput): AgentRunRecord | undefined {
  return finishRun(id, {
    status: input.status ?? 'failed',
    outputSummary: input.outputSummary,
    error: errorMessage(input.error),
    archive: input.archive,
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

export function coerceAgentRunPermissionMode(mode: unknown): AgentRunPermissionMode {
  return normalizePermissionMode(mode);
}

/**
 * Test-only: clear memory and delete every ledger file under the current
 * mind root — shards of other (test) processes and legacy files included.
 * Production code must never delete foreign shards; tests need a clean slate.
 */
export function resetAgentRunsForTest(): void {
  const store = getStore();
  store.records = [];
  store.events = [];
  store.ownRecordIds.clear();
  if (!store.mindRoot) return;
  try {
    const dir = ledgerDirPath(store.mindRoot);
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (SHARD_FILE_PATTERN.test(name) || name === LEDGER_LEGACY_JSON_NAME || name === LEDGER_LEGACY_JSONL_NAME) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // Test cleanup is best-effort.
  }
}

/** Test-only: drop the in-memory store so the next access re-merges from disk. */
export function reloadAgentRunsFromDiskForTest(): void {
  deleteProcessGlobal(AGENT_RUN_LEDGER_STORE_KEY);
}
