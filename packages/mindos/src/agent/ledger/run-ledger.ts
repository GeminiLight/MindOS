import { effectiveMindRoot, mindRootResolverGeneration } from '../../foundation/mind-root/index.js';
import { closeMindosDatabase, type MindosDatabase } from '../../foundation/storage/sqlite.js';
import { getCurrentAgentRunContext } from '../agent-run-context.js';
import {
  AGENT_RUN_LEDGER_SHARD_KEY,
  AGENT_RUN_LEDGER_STORE_KEY,
  AGENT_RUN_LEDGER_SUBSCRIBERS_KEY,
  deleteProcessGlobal,
  getProcessGlobal,
} from '../global-state.js';
import { emitStudioAutomationEvent, recordStudioAutomationEventSourceFailure } from '../../server/automations/events.js';
import {
  EVENT_TRIM_SLACK,
  MAX_EVENTS,
  MAX_RUNS,
  clearLedger,
  insertEventRow,
  listEventRows,
  listRunRows,
  openLedgerDatabase,
  parseRunRow,
  pruneRunEvents,
  pruneRuns,
  readRunRow,
  rowOwner,
  upsertRun,
  type RunRow,
} from './run-ledger-db.js';
import {
  LEGACY_LEDGER_FILE_PATTERN,
  hasLegacyLedgerFiles,
  isDeadOwner,
  ledgerDirPath,
  readLegacyLedgerFiles,
  renameLegacyFileToMigrated,
  type RunOwner,
} from './run-ledger-legacy-import.js';
import {
  createEventId,
  createRunId,
  errorMessage,
  isTerminalStatus,
  markOrphanedRun,
  normalizeArchiveRef,
  normalizeEventCategory,
  normalizeEventPatch,
  normalizePermissionMode,
  nowMs,
  redactMetadata,
  truncateSummary,
} from './run-ledger-normalize.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cross-runtime agent run ledger — an INDEX CARD store, not a transcript
 * store (spec-agent-core-consolidation B.1/C), persisted in `node:sqlite`
 * (spec-sqlite-derived-stores).
 *
 * Each runtime keeps its own full archive (Claude Code: ~/.claude, Codex:
 * ~/.codex, embedded Pi: SessionManager archive when session-bound). The ledger
 * persists run records — id / kind / status / parent-child links / timestamps /
 * capped summaries / an `archive` pointer into the runtime's own archive — plus
 * a bounded window of timeline and debug events per run, so the UI can list
 * runs, replay recent events and reattach after a restart.
 *
 * Persistence model — one WAL-mode database per mind root:
 *   <mindRoot>/.mindos/db/agent_runs_1.sqlite
 * Every write is a single statement (or one short transaction), so several
 * MindOS processes share the file safely without per-process shards, and a
 * run created by one process is visible to the others on their next read.
 * Realtime subscribers stay in-process; the SSE bridge subscribes in the
 * process that produces the events.
 */

export * from './run-ledger-types.js';
import type {
  AgentEvent,
  AgentEventType,
  AgentRunPermissionMode,
  AgentRunRecord,
  AppendAgentEventInput,
  CancelAgentRunInput,
  CompleteAgentRunInput,
  FailAgentRunInput,
  ListAgentEventsOptions,
  ListAgentRunsOptions,
  StartAgentRunInput,
  UpdateAgentRunInput,
} from './run-ledger-types.js';

export type AgentRunEventSubscriber = (event: AgentEvent) => void;

/**
 * `effectiveMindRoot()` stats ~/.mindos/config.json on every call and the
 * ledger resolves it for every appended event. Memoize the answer briefly;
 * resolver changes (test seam) and MIND_ROOT env changes invalidate at once.
 */
const LEDGER_ROOT_CACHE_MS = 2000;

type LedgerProcessState = {
  mindRoot: string | undefined;
  db: MindosDatabase | null;
  /** Legacy files were imported for the current handle. */
  imported: boolean;
  /** Appends since the last per-run prune, keyed by `${runId}\n${visibility}`. */
  pendingPrunes: Map<string, number>;
};

type OwnerIdentity = { pid: number; startTs: number };

function ownerIdentity(): OwnerIdentity {
  return getProcessGlobal(AGENT_RUN_LEDGER_SHARD_KEY, () => ({
    pid: process.pid,
    // performance.timeOrigin is identical for every module copy in the
    // process, unlike a Date.now() captured at each copy's load time.
    startTs: Math.round(performance.timeOrigin),
  }));
}

function freshState(mindRoot: string | undefined): LedgerProcessState {
  return { mindRoot, db: null, imported: false, pendingPrunes: new Map() };
}

type LedgerRootCache = {
  root: string | undefined;
  resolvedAt: number;
  generation: number;
  envRoot: string | undefined;
};

let ledgerRootCache: LedgerRootCache | null = null;

function invalidateLedgerRootCache(): void {
  ledgerRootCache = null;
}

function resolveLedgerRoot(): string | undefined {
  const now = Date.now();
  const generation = mindRootResolverGeneration();
  const envRoot = process.env.MIND_ROOT;
  const cached = ledgerRootCache;
  if (
    cached
    && cached.generation === generation
    && cached.envRoot === envRoot
    && now >= cached.resolvedAt
    && now - cached.resolvedAt < LEDGER_ROOT_CACHE_MS
  ) {
    return cached.root;
  }

  let root: string | undefined;
  try {
    const resolved = effectiveMindRoot();
    root = typeof resolved === 'string' && resolved.trim() ? resolved : undefined;
  } catch {
    root = undefined;
  }
  ledgerRootCache = { root, resolvedAt: now, generation, envRoot };
  return root;
}

function getState(): LedgerProcessState {
  const mindRoot = resolveLedgerRoot();
  let state = getProcessGlobal<LedgerProcessState>(AGENT_RUN_LEDGER_STORE_KEY, () => freshState(mindRoot));
  if (state.mindRoot !== mindRoot) {
    deleteProcessGlobal(AGENT_RUN_LEDGER_STORE_KEY);
    state = getProcessGlobal<LedgerProcessState>(AGENT_RUN_LEDGER_STORE_KEY, () => freshState(mindRoot));
  }
  return state;
}

/**
 * Returns the ledger database, opening it on demand. Read paths pass
 * `create: false` and get null while nothing has been persisted yet (unless
 * legacy files are waiting to be imported); write paths always get a handle.
 */
function getLedger(options: { create: boolean }): MindosDatabase | null {
  const state = getState();
  if (!state.db || !state.db.isOpen) {
    const mustCreate = options.create || (state.mindRoot !== undefined && hasLegacyLedgerFiles(state.mindRoot));
    const db = openLedgerDatabase(state.mindRoot, { create: mustCreate });
    if (!db) return null;
    state.db = db;
    state.imported = false;
    state.pendingPrunes.clear();
  }
  if (!state.imported) {
    state.imported = true;
    if (state.mindRoot) importLegacyLedger(state.mindRoot, state.db);
  }
  return state.db;
}

// --- legacy import ---

const conflictWarnedRunIds = new Set<string>();

function ownerKey(owner: RunOwner): string {
  return owner ? `${owner.pid}-${owner.startTs}` : 'legacy';
}

function warnConflictOnce(runId: string): void {
  if (conflictWarnedRunIds.has(runId)) return;
  conflictWarnedRunIds.add(runId);
  console.warn(`[mindos] agent run ledger: run id ${runId} appears in multiple ledger sources; keeping the most recent write.`);
}

function importLegacyLedger(mindRoot: string, db: MindosDatabase): void {
  let legacy;
  try {
    legacy = readLegacyLedgerFiles(mindRoot);
  } catch {
    return;
  }
  if (legacy.files.length === 0) return;
  const self = ownerIdentity();
  try {
    db.transaction(() => {
      const seen = new Map<string, string>();
      for (const entry of legacy.runs) {
        const key = ownerKey(entry.owner);
        const existing = readRunRow(db, entry.record.id);
        const previous = seen.get(entry.record.id) ?? (existing ? ownerKey(rowOwner(existing)) : undefined);
        // Same run id written from two places (spec edge case: cross-process id
        // collision). Resolve last-write-wins by timestamp and surface it once.
        if (previous !== undefined && previous !== key) warnConflictOnce(entry.record.id);
        seen.set(entry.record.id, key);
        upsertRun(db, entry.record, entry.owner, entry.ts, { onlyIfNewer: true });
      }
      for (const event of legacy.events) insertEventRow(db, event);
      pruneRuns(db);
    });
  } catch {
    // Unreadable legacy data must never block the ledger.
    return;
  }
  for (const file of legacy.files) {
    if (isDeadOwner(file.owner, self)) renameLegacyFileToMigrated(file.file);
  }
}

// --- projections ---

/** Read-time orphan view: rows whose owner died before a terminal status are reported failed. */
function projectRow(row: RunRow, self: OwnerIdentity): AgentRunRecord | null {
  const record = parseRunRow(row);
  if (!record) return null;
  if (isTerminalStatus(record.status)) return record;
  const owner = rowOwner(row);
  if (owner && owner.pid === self.pid && owner.startTs === self.startTs) return record;
  return isDeadOwner(owner, self) ? markOrphanedRun(record) : record;
}

function readRun(db: MindosDatabase, id: string): AgentRunRecord | undefined {
  const row = readRunRow(db, id);
  if (!row) return undefined;
  return projectRow(row, ownerIdentity()) ?? undefined;
}

// --- subscribers ---

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

// --- writes ---

function persistEvent(event: AgentEvent): void {
  const db = getLedger({ create: true });
  if (!db) return;
  try {
    insertEventRow(db, event);
    const state = getState();
    const visibility = event.visibility ?? 'timeline';
    const key = `${event.runId}\n${visibility}`;
    const pending = (state.pendingPrunes.get(key) ?? 0) + 1;
    if (pending >= EVENT_TRIM_SLACK) {
      pruneRunEvents(db, event.runId, visibility);
      state.pendingPrunes.set(key, 0);
    } else {
      state.pendingPrunes.set(key, pending);
    }
  } catch {
    // Ledger persistence must never affect agent execution.
  }
}

function appendAgentEvent(record: AgentRunRecord, input: AgentEventType | AppendAgentEventInput, message?: string): AgentEvent {
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
  persistEvent(event);
  notifyAgentEventSubscribers(event);
  return event;
}

function persistRun(record: AgentRunRecord): void {
  const db = getLedger({ create: true });
  if (!db) return;
  try {
    db.transaction(() => {
      upsertRun(db, record, ownerIdentity(), nowMs());
      pruneRuns(db);
    });
  } catch {
    // Ledger persistence must never affect agent execution.
  }
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
  const current = getAgentRun(id);
  if (!current) return undefined;
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
  persistRun(next);
  const eventType = patch.status === 'completed'
    ? 'run_completed'
    : patch.status === 'canceled'
      ? 'run_canceled'
      : 'run_failed';
  appendAgentEvent(next, eventType, patch.error);
  emitTerminalRunAutomationEvent(getState().mindRoot, next);
  return next;
}

function emitTerminalRunAutomationEvent(mindRoot: string | undefined, record: AgentRunRecord): void {
  if (!mindRoot) return;
  try {
    emitStudioAutomationEvent(mindRoot, {
      source: 'agent',
      key: record.id,
      type: `agent.run.${record.status}`,
      occurredAt: new Date(record.completedAt ?? Date.now()),
      payload: {
        runId: record.id,
        rootRunId: record.rootRunId,
        parentRunId: record.parentRunId,
        runtimeId: record.runtimeId,
        agentKind: record.agentKind,
        displayName: record.displayName,
        status: record.status,
        durationMs: record.durationMs,
        outputSummary: record.outputSummary,
        error: record.error,
      },
    });
  } catch (error) {
    recordStudioAutomationEventSourceFailure(mindRoot, { source: 'agent', key: record.id, error });
    // Automation projection is best-effort and must never change run completion semantics.
  }
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

  persistRun(record);
  appendAgentEvent(record, 'run_started');
  return record;
}

export function updateAgentRun(id: string, input: UpdateAgentRunInput): AgentRunRecord | undefined {
  const current = getAgentRun(id);
  if (!current) return undefined;

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
  persistRun(next);
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

// --- reads ---

export function getAgentRun(id: string): AgentRunRecord | undefined {
  const db = getLedger({ create: false });
  if (!db) return undefined;
  try {
    return readRun(db, id);
  } catch {
    return undefined;
  }
}

export function listAgentRuns(options: ListAgentRunsOptions = {}): AgentRunRecord[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, MAX_RUNS));
  const db = getLedger({ create: false });
  if (!db) return [];
  try {
    const self = ownerIdentity();
    // The status filter applies to the projected status (an orphaned run reads
    // as failed), so it cannot be pushed into SQL; every other filter can.
    const rows = listRunRows(db, options, options.status ? null : limit);
    const records: AgentRunRecord[] = [];
    for (const row of rows) {
      const record = projectRow(row, self);
      if (!record) continue;
      if (options.status && record.status !== options.status) continue;
      records.push(record);
      if (records.length >= limit) break;
    }
    return records;
  } catch {
    return [];
  }
}

export function listAgentEvents(options: ListAgentEventsOptions = {}): AgentEvent[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, MAX_EVENTS));
  const db = getLedger({ create: false });
  if (!db) return [];
  try {
    return listEventRows(db, options, limit);
  } catch {
    return [];
  }
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

// --- test seams ---

/**
 * Test-only: empty the ledger database for the current mind root and delete
 * every legacy ledger file (originals and `*.migrated` copies). The database
 * is not created when it does not exist yet, so suites asserting an untouched
 * mind root keep passing.
 */
export function resetAgentRunsForTest(): void {
  invalidateLedgerRootCache();
  const state = getState();
  state.pendingPrunes.clear();
  try {
    const db = state.db?.isOpen ? state.db : openLedgerDatabase(state.mindRoot, { create: false });
    if (db) {
      clearLedger(db);
      state.db = db;
      state.imported = true;
    }
  } catch {
    // Test cleanup is best-effort.
  }
  if (!state.mindRoot) return;
  try {
    const dir = ledgerDirPath(state.mindRoot);
    if (!dir || !fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (LEGACY_LEDGER_FILE_PATTERN.test(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    // Test cleanup is best-effort.
  }
}

/** Test-only: drop the cached handle so the next access re-opens the database and re-imports legacy files. */
export function reloadAgentRunsFromDiskForTest(): void {
  invalidateLedgerRootCache();
  const state = getProcessGlobal<LedgerProcessState | null>(AGENT_RUN_LEDGER_STORE_KEY, () => null);
  if (state?.db) closeMindosDatabase(state.db.file);
  deleteProcessGlobal(AGENT_RUN_LEDGER_STORE_KEY);
}
