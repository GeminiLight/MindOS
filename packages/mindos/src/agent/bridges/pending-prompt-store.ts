import { effectiveMindRoot, mindRootResolverGeneration } from '../../foundation/mind-root/index.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  closeMindosDatabase,
  openMindosDatabase,
  openMindosDatabaseIfExists,
  openMindosMemoryDatabase,
  type MindosDatabase,
  type MindosDatabaseMigration,
} from '../../foundation/storage/sqlite.js';
import { AGENT_PENDING_PROMPTS_KEY, getProcessGlobal } from '../global-state.js';
import { agentLedgerOwnerIdentity } from '../ledger/run-ledger.js';
import { isDeadOwner } from '../ledger/run-ledger-legacy-import.js';
import type { PendingRuntimePermissionSnapshot } from './runtime-permission-bridge.js';
import type { AskUserQuestionAnswer, PendingAskUserQuestionSnapshot } from './user-question-bridge.js';

/**
 * Cross-process pending prompt store (spec-cross-process-run-events B).
 *
 * The runtime-permission and user-question bridges keep their pending prompts
 * in an in-process Map, so a prompt raised in one host (the Next server) is
 * invisible to every other host (Product Server, automation worker) and dies
 * with the process that holds it. This store mirrors each open prompt into a
 * small WAL sqlite file next to the run ledger:
 *
 *   <mindRoot>/.mindos/db/agent_pending_prompts_1.sqlite
 *
 * Any process can then list open prompts (`GET /api/agent/pending-actions`)
 * and submit a decision for a prompt it does not hold; the owning process
 * drains submitted decisions through a short tail timer and resolves the
 * original promise. Resolution is first-writer-wins: one guarded
 * `UPDATE ... WHERE resolved_at IS NULL` decides the race, losers read 404.
 *
 * Every function is best-effort: a store failure only costs cross-process
 * visibility and must never break the in-process bridge path.
 */

export const PENDING_PROMPT_DB_RELATIVE_PATH = '.mindos/db/agent_pending_prompts_1.sqlite';

/** Prune is amortized: run it once per this many writes. */
const PRUNE_WRITE_SLACK = 32;
/** Resolved / expired rows are kept for evidence for one hour, then dropped. */
const PRUNE_MAX_AGE_MS = 60 * 60 * 1000;

const MEMORY_DB_KEY = 'agent-pending-prompts';

const MIGRATIONS: MindosDatabaseMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE agent_pending_prompts(
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        run_id TEXT NOT NULL,
        prompt_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        owner_start_ts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER,
        decision_json TEXT,
        consumed_at INTEGER,
        snapshot_json TEXT NOT NULL
      );
      CREATE INDEX idx_agent_pending_prompts_open ON agent_pending_prompts(resolved_at, expires_at);
      CREATE INDEX idx_agent_pending_prompts_owner ON agent_pending_prompts(owner_pid, owner_start_ts, consumed_at);
      CREATE TABLE agent_pending_prompts_meta(
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        writer_pid INTEGER,
        writer_start_ts INTEGER
      );
      INSERT INTO agent_pending_prompts_meta(id, version) VALUES (1, 0);
    `,
  },
];

export type PendingPromptKind = 'runtime-permission' | 'user-question';

export type PendingPromptSnapshot = PendingRuntimePermissionSnapshot | PendingAskUserQuestionSnapshot;

/** A decision submitted by any process for a prompt it may not hold. */
export type PendingPromptDecision =
  | { type: 'permission-decision'; decision: string }
  | { type: 'question-answers'; answers: AskUserQuestionAnswer[] }
  | { type: 'question-cancel'; reason: string };

export type PendingPromptRow = {
  key: string;
  kind: PendingPromptKind;
  runId: string;
  /** requestId for permissions, toolCallId for questions. */
  promptId: string;
  owner: { pid: number; startTs: number };
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  decision: PendingPromptDecision | null;
  consumedAt: number | null;
  snapshot: PendingPromptSnapshot;
};

export type PendingPromptDecisionRow = {
  key: string;
  kind: PendingPromptKind;
  runId: string;
  promptId: string;
  decision: PendingPromptDecision;
};

export type PendingPromptStoreVersion = {
  version: number;
  writerPid: number | null;
  writerStartTs: number | null;
};

export function pendingPromptKey(
  snapshot: { kind: 'runtime-permission'; runId: string; requestId: string }
    | { kind: 'user-question'; runId: string; toolCallId: string },
): string {
  return snapshot.kind === 'runtime-permission'
    ? `runtime-permission:${snapshot.runId}:${snapshot.requestId}`
    : `user-question:${snapshot.runId}:${snapshot.toolCallId}`;
}

function promptIdOf(snapshot: PendingPromptSnapshot): string {
  return snapshot.kind === 'runtime-permission' ? snapshot.requestId : snapshot.toolCallId;
}

// --- process state ---

type PendingPromptStoreState = {
  mindRoot: string | undefined;
  db: MindosDatabase | null;
  writesSincePrune: number;
  /** Shared with the tail bridge through subscribePendingPromptChanges. */
  listeners: Set<() => void>;
  /** Owner-side tail that drains decisions submitted by other processes. */
  decisionTailTimer: ReturnType<typeof setInterval> | null;
};

function freshState(mindRoot: string | undefined): PendingPromptStoreState {
  return { mindRoot, db: null, writesSincePrune: 0, listeners: new Set(), decisionTailTimer: null };
}

/** Mirrors the ledger's short-lived root cache: prompt writes are rare, the tail reads once per second. */
const STORE_ROOT_CACHE_MS = 2000;
let storeRootCache: { root: string | undefined; resolvedAt: number; generation: number; envRoot: string | undefined } | null = null;

function resolveStoreRoot(): string | undefined {
  const now = Date.now();
  const generation = mindRootResolverGeneration();
  const envRoot = process.env.MIND_ROOT;
  const cached = storeRootCache;
  if (
    cached
    && cached.generation === generation
    && cached.envRoot === envRoot
    && now >= cached.resolvedAt
    && now - cached.resolvedAt < STORE_ROOT_CACHE_MS
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
  storeRootCache = { root, resolvedAt: now, generation, envRoot };
  return root;
}

function getState(): PendingPromptStoreState {
  const mindRoot = resolveStoreRoot();
  const state = getProcessGlobal<PendingPromptStoreState>(AGENT_PENDING_PROMPTS_KEY, () => freshState(mindRoot));
  if (state.mindRoot !== mindRoot) {
    // A root switch drops the handle but keeps listeners and the tail timer:
    // they belong to bridges and the event bus, not to one database file.
    if (state.db?.isOpen) {
      try { closeMindosDatabase(state.db.file); } catch { /* best-effort */ }
    }
    state.mindRoot = mindRoot;
    state.db = null;
    state.writesSincePrune = 0;
  }
  return state;
}

function openStoreDatabase(mindRoot: string | undefined, options: { create: boolean }): MindosDatabase | null {
  if (!mindRoot) return openMindosMemoryDatabase(MEMORY_DB_KEY, MIGRATIONS);
  let file: string;
  try {
    file = resolveExistingSafe(mindRoot, PENDING_PROMPT_DB_RELATIVE_PATH);
  } catch {
    return openMindosMemoryDatabase(MEMORY_DB_KEY, MIGRATIONS);
  }
  return options.create
    ? openMindosDatabase({ file, migrations: MIGRATIONS })
    : openMindosDatabaseIfExists({ file, migrations: MIGRATIONS });
}

/**
 * The store database, opened on demand. Read paths pass `create: false` and
 * get null while no prompt was ever persisted, so listing never leaves a file
 * behind; write paths always get a handle (memory fallback without a root).
 */
export function getPendingPromptDatabase(options: { create: boolean }): MindosDatabase | null {
  const state = getState();
  if (!state.db || !state.db.isOpen) {
    const db = openStoreDatabase(state.mindRoot, options);
    if (!db) return null;
    state.db = db;
  }
  return state.db;
}

// --- change notification ---

/**
 * In-process "something changed" signal. The owning bridge notifies on enqueue
 * and finish; hosts bridge this onto the event bus as
 * `run.pending-actions.changed`. Cross-process changes are discovered by the
 * ledger tail bridge through the meta version counter instead.
 */
export function subscribePendingPromptChanges(listener: () => void): () => void {
  const listeners = getState().listeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyPendingPromptChange(): void {
  for (const listener of Array.from(getState().listeners)) {
    try {
      listener();
    } catch {
      // Observers must never affect the bridge that notified them.
    }
  }
}

/**
 * Owner-side decision tail timer slot, shared across module copies so exactly
 * one drain loop runs per process (see AGENT_PENDING_PROMPTS_KEY). Managed by
 * pending-prompt-changes.ts.
 */
export function getPendingDecisionTailTimer(): ReturnType<typeof setInterval> | null {
  return getState().decisionTailTimer;
}

export function setPendingDecisionTailTimer(timer: ReturnType<typeof setInterval> | null): void {
  getState().decisionTailTimer = timer;
}

// --- writes ---

function bumpMeta(db: MindosDatabase): void {
  const self = agentLedgerOwnerIdentity();
  db.prepare('UPDATE agent_pending_prompts_meta SET version = version + 1, writer_pid = ?, writer_start_ts = ? WHERE id = 1')
    .run(self.pid, self.startTs);
}

/** Persists (or re-records) an open prompt. Returns false when the store is unavailable. */
export function recordPendingPrompt(snapshot: PendingPromptSnapshot): boolean {
  const db = getPendingPromptDatabase({ create: true });
  if (!db) return false;
  try {
    const self = agentLedgerOwnerIdentity();
    const now = Date.now();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO agent_pending_prompts(
          key, kind, run_id, prompt_id, owner_pid, owner_start_ts,
          created_at, expires_at, updated_at, resolved_at, decision_json, consumed_at, snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
        ON CONFLICT(key) DO UPDATE SET
          kind = excluded.kind,
          run_id = excluded.run_id,
          prompt_id = excluded.prompt_id,
          owner_pid = excluded.owner_pid,
          owner_start_ts = excluded.owner_start_ts,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at,
          resolved_at = NULL,
          decision_json = NULL,
          consumed_at = NULL,
          snapshot_json = excluded.snapshot_json
      `).run(
        pendingPromptKey(snapshot),
        snapshot.kind,
        snapshot.runId,
        promptIdOf(snapshot),
        self.pid,
        self.startTs,
        snapshot.createdAt,
        snapshot.expiresAt,
        now,
        JSON.stringify(snapshot),
      );
      bumpMeta(db);
    });
    amortizedPrune(db);
    notifyPendingPromptChange();
    return true;
  } catch {
    // Cross-process visibility is best-effort; the in-process Map still works.
    return false;
  }
}

/**
 * The owner marks a prompt finished (decided locally, timed out, aborted, or
 * its run ended). Returns false when nothing was open under `key`.
 */
export function finishPendingPrompt(key: string): boolean {
  const db = getPendingPromptDatabase({ create: false });
  if (!db) return false;
  try {
    const now = Date.now();
    let changed = 0;
    db.transaction(() => {
      changed = db.prepare('UPDATE agent_pending_prompts SET resolved_at = ?, updated_at = ? WHERE key = ? AND resolved_at IS NULL')
        .run(now, now, key).changes;
      if (changed > 0) bumpMeta(db);
    });
    amortizedPrune(db);
    if (changed > 0) notifyPendingPromptChange();
    return changed > 0;
  } catch {
    return false;
  }
}

export type SubmitPendingPromptDecisionResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'resolved' };

/**
 * Submit a decision for a prompt this process does not hold. One guarded
 * UPDATE makes resolution first-writer-wins: the second submitter reads
 * `resolved`. A prompt whose owner died can never be resolved (`missing`).
 */
export function submitPendingPromptDecision(
  key: string,
  decision: PendingPromptDecision,
): SubmitPendingPromptDecisionResult {
  const db = getPendingPromptDatabase({ create: false });
  if (!db) return { ok: false, reason: 'missing' };
  try {
    const row = db.prepare('SELECT resolved_at, owner_pid, owner_start_ts FROM agent_pending_prompts WHERE key = ?')
      .get(key) as { resolved_at: number | null; owner_pid: number; owner_start_ts: number } | undefined;
    if (!row) return { ok: false, reason: 'missing' };
    if (row.resolved_at !== null) return { ok: false, reason: 'resolved' };
    if (isDeadOwner({ pid: Number(row.owner_pid), startTs: Number(row.owner_start_ts) }, agentLedgerOwnerIdentity())) {
      return { ok: false, reason: 'missing' };
    }
    const now = Date.now();
    let changed = 0;
    db.transaction(() => {
      changed = db.prepare(`
        UPDATE agent_pending_prompts
        SET decision_json = ?, resolved_at = ?, updated_at = ?
        WHERE key = ? AND resolved_at IS NULL
      `).run(JSON.stringify(decision), now, now, key).changes;
      if (changed > 0) bumpMeta(db);
    });
    if (changed === 0) return { ok: false, reason: 'resolved' };
    notifyPendingPromptChange();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}

export function markPendingDecisionConsumed(key: string): void {
  const db = getPendingPromptDatabase({ create: false });
  if (!db) return;
  try {
    db.prepare('UPDATE agent_pending_prompts SET consumed_at = ? WHERE key = ?').run(Date.now(), key);
  } catch {
    // A missed consumption mark only causes one redundant drain attempt.
  }
}

// --- reads ---

type RawRow = {
  key: string;
  kind: string;
  run_id: string;
  prompt_id: string;
  owner_pid: number;
  owner_start_ts: number;
  created_at: number;
  expires_at: number;
  resolved_at: number | null;
  decision_json: string | null;
  consumed_at: number | null;
  snapshot_json: string;
};

function parseRow(row: RawRow): PendingPromptRow | null {
  if (row.kind !== 'runtime-permission' && row.kind !== 'user-question') return null;
  let snapshot: PendingPromptSnapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json) as PendingPromptSnapshot;
  } catch {
    return null;
  }
  let decision: PendingPromptDecision | null = null;
  if (row.decision_json !== null) {
    try {
      decision = JSON.parse(row.decision_json) as PendingPromptDecision;
    } catch {
      decision = null;
    }
  }
  return {
    key: row.key,
    kind: row.kind,
    runId: row.run_id,
    promptId: row.prompt_id,
    owner: { pid: Number(row.owner_pid), startTs: Number(row.owner_start_ts) },
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
    decision,
    consumedAt: row.consumed_at === null ? null : Number(row.consumed_at),
    snapshot,
  };
}

const OPEN_ROW_COLUMNS = `key, kind, run_id, prompt_id, owner_pid, owner_start_ts,
  created_at, expires_at, resolved_at, decision_json, consumed_at, snapshot_json`;

/** Open, unexpired prompts whose owner process is still alive, oldest first. */
export function listOpenPendingPrompts(now: number): PendingPromptRow[] {
  const db = getPendingPromptDatabase({ create: false });
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT ${OPEN_ROW_COLUMNS} FROM agent_pending_prompts
      WHERE resolved_at IS NULL AND expires_at > ?
      ORDER BY created_at ASC, key ASC
    `).all(now) as unknown as RawRow[];
    const self = agentLedgerOwnerIdentity();
    const open: PendingPromptRow[] = [];
    for (const row of rows) {
      const parsed = parseRow(row);
      if (!parsed) continue;
      if (isDeadOwner(parsed.owner, self)) continue;
      open.push(parsed);
    }
    return open;
  } catch {
    return [];
  }
}

/** One open row by key (null when missing, resolved, expired, corrupt, or owned by a dead process). */
export function readOpenPendingPrompt(key: string, now: number): PendingPromptRow | null {
  const db = getPendingPromptDatabase({ create: false });
  if (!db) return null;
  try {
    const row = db.prepare(`SELECT ${OPEN_ROW_COLUMNS} FROM agent_pending_prompts WHERE key = ?`).get(key) as unknown as RawRow | undefined;
    if (!row) return null;
    const parsed = parseRow(row);
    if (!parsed) return null;
    if (parsed.resolvedAt !== null || parsed.expiresAt <= now) return null;
    if (isDeadOwner(parsed.owner, agentLedgerOwnerIdentity())) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Decisions other processes submitted for prompts THIS process owns and still holds. */
export function readPendingDecisionsForOwner(): PendingPromptDecisionRow[] {
  const db = getPendingPromptDatabase({ create: false });
  if (!db) return [];
  try {
    const self = agentLedgerOwnerIdentity();
    const rows = db.prepare(`
      SELECT key, kind, run_id, prompt_id, decision_json FROM agent_pending_prompts
      WHERE decision_json IS NOT NULL AND consumed_at IS NULL AND owner_pid = ? AND owner_start_ts = ?
      ORDER BY updated_at ASC, key ASC
    `).all(self.pid, self.startTs) as unknown as Array<{
      key: string; kind: string; run_id: string; prompt_id: string; decision_json: string;
    }>;
    const decisions: PendingPromptDecisionRow[] = [];
    for (const row of rows) {
      if (row.kind !== 'runtime-permission' && row.kind !== 'user-question') continue;
      try {
        decisions.push({
          key: row.key,
          kind: row.kind,
          runId: row.run_id,
          promptId: row.prompt_id,
          decision: JSON.parse(row.decision_json) as PendingPromptDecision,
        });
      } catch {
        // A corrupt decision is consumed by the drain loop to stop retries.
        decisions.push({
          key: row.key,
          kind: row.kind,
          runId: row.run_id,
          promptId: row.prompt_id,
          decision: { type: 'question-cancel', reason: 'corrupt-decision' },
        });
      }
    }
    return decisions;
  } catch {
    return [];
  }
}

/** Meta version + last writer; the tail bridge polls this to spot cross-process changes. */
export function readPendingPromptStoreVersion(): PendingPromptStoreVersion | null {
  const db = getPendingPromptDatabase({ create: false });
  if (!db) return null;
  try {
    const row = db.prepare('SELECT version, writer_pid, writer_start_ts FROM agent_pending_prompts_meta WHERE id = 1')
      .get() as { version: number; writer_pid: number | null; writer_start_ts: number | null } | undefined;
    if (!row) return null;
    return {
      version: Number(row.version),
      writerPid: row.writer_pid === null ? null : Number(row.writer_pid),
      writerStartTs: row.writer_start_ts === null ? null : Number(row.writer_start_ts),
    };
  } catch {
    return null;
  }
}

// --- prune ---

function amortizedPrune(db: MindosDatabase): void {
  const state = getState();
  state.writesSincePrune += 1;
  if (state.writesSincePrune < PRUNE_WRITE_SLACK) return;
  state.writesSincePrune = 0;
  try {
    prunePendingPromptStore(Date.now(), db);
  } catch {
    // Pruning is housekeeping; a failure only leaves evidence rows behind.
  }
}

/** Drops rows resolved or expired more than an hour ago. */
export function prunePendingPromptStore(now: number, dbOverride?: MindosDatabase): void {
  const db = dbOverride ?? getPendingPromptDatabase({ create: false });
  if (!db) return;
  const cutoff = now - PRUNE_MAX_AGE_MS;
  db.prepare(`
    DELETE FROM agent_pending_prompts
    WHERE (resolved_at IS NOT NULL AND resolved_at < ?) OR expires_at < ?
  `).run(cutoff, cutoff);
}

// --- test seam ---

/** Test-only: stop the tail timer, drop listeners and the handle for the current root. */
export function resetPendingPromptStoreForTest(): void {
  storeRootCache = null;
  const state = getProcessGlobal<PendingPromptStoreState | null>(AGENT_PENDING_PROMPTS_KEY, () => null);
  delete (globalThis as Record<symbol, unknown>)[AGENT_PENDING_PROMPTS_KEY];
  if (!state) return;
  if (state.decisionTailTimer) {
    clearInterval(state.decisionTailTimer);
    state.decisionTailTimer = null;
  }
  state.listeners.clear();
  if (state.db?.isOpen) {
    try { closeMindosDatabase(state.db.file); } catch { /* best-effort */ }
  }
}
