import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  openMindosDatabase,
  openMindosDatabaseIfExists,
  openMindosMemoryDatabase,
  type MindosDatabase,
  type MindosDatabaseMigration,
} from '../../foundation/storage/sqlite.js';
import type { RunOwner } from './run-ledger-legacy-import.js';
import type {
  AgentEvent,
  AgentEventType,
  AgentEventVisibility,
  AgentRunRecord,
  ListAgentEventsOptions,
  ListAgentRunsOptions,
} from './run-ledger-types.js';

/**
 * SQLite schema and row access for the agent run ledger
 * (spec-sqlite-derived-stores). `agent_runs` keeps one row per run with the
 * filter columns the API uses plus the full record as JSON; `agent_run_events`
 * keeps timeline and debug events in one table, distinguished by
 * `visibility`, ordered by the autoincrement `seq`.
 *
 * Event rows carry only the event payload (spec-ledger-write-cost): the run
 * record is joined back from `agent_runs` at read time. Lifecycle and
 * permission events keep an embedded snapshot of the record as it was when
 * they happened, and rows written before the spec (record embedded in every
 * row) read back unchanged.
 */

export const LEDGER_DB_RELATIVE_PATH = '.mindos/db/agent_runs_1.sqlite';
export const MAX_RUNS = 500;
export const MAX_EVENTS = 1000;
/** Newest events kept per run and visibility class (replaces the two in-memory rings). */
export const MAX_EVENTS_PER_RUN_VISIBILITY = 1000;
/** Per-run pruning is amortized: run it once per this many appends. */
export const EVENT_TRIM_SLACK = 200;

const MEMORY_DB_KEY = 'agent-run-ledger';

const MIGRATIONS: MindosDatabaseMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE agent_runs(
        id TEXT PRIMARY KEY,
        root_run_id TEXT,
        parent_run_id TEXT,
        chat_session_id TEXT,
        agent_kind TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL,
        owner_pid INTEGER,
        owner_start_ts INTEGER,
        run_json TEXT NOT NULL
      );
      CREATE INDEX idx_agent_runs_started ON agent_runs(started_at DESC);
      CREATE INDEX idx_agent_runs_chat ON agent_runs(chat_session_id, started_at DESC);
      CREATE INDEX idx_agent_runs_root ON agent_runs(root_run_id);
      CREATE INDEX idx_agent_runs_status ON agent_runs(status);
      CREATE TABLE agent_run_events(
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        root_run_id TEXT,
        chat_session_id TEXT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'timeline',
        run_started_at INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX idx_agent_run_events_run ON agent_run_events(run_id, seq);
      CREATE INDEX idx_agent_run_events_ts ON agent_run_events(ts DESC);
      CREATE INDEX idx_agent_run_events_run_visibility ON agent_run_events(run_id, visibility, seq);
    `,
  },
  {
    // Artifact pointer index (spec-ledger-write-cost P2): shares the ledger
    // file because every process that records artifacts already has it open,
    // and artifacts are index cards about runs. Rows are the sanitized record
    // as JSON plus the columns the API filters on.
    version: 2,
    sql: `
      CREATE TABLE agent_artifacts(
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        agent_kind TEXT NOT NULL,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        session_id TEXT,
        external_session_id TEXT,
        run_id TEXT,
        tool_call_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        artifact_json TEXT NOT NULL
      );
      CREATE INDEX idx_agent_artifacts_run ON agent_artifacts(run_id, created_at);
      CREATE INDEX idx_agent_artifacts_created ON agent_artifacts(created_at DESC);
      CREATE INDEX idx_agent_artifacts_updated ON agent_artifacts(updated_at DESC);
    `,
  },
];

export interface RunRow {
  id: string;
  status: string;
  started_at: number;
  updated_at: number;
  owner_pid: number | null;
  owner_start_ts: number | null;
  run_json: string;
}

const RUN_COLUMNS = 'id, status, started_at, updated_at, owner_pid, owner_start_ts, run_json';

export function ledgerDatabaseFile(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, LEDGER_DB_RELATIVE_PATH);
}

/**
 * Opens the ledger database for `mindRoot`. Without a resolvable root (or
 * when the path cannot be validated) the ledger falls back to an in-process
 * memory database so run tracking keeps working for the current process.
 * Read paths pass `create: false` and get null when nothing exists yet.
 */
export function openLedgerDatabase(mindRoot: string | undefined, options: { create: boolean }): MindosDatabase | null {
  if (!mindRoot) return openMindosMemoryDatabase(MEMORY_DB_KEY, MIGRATIONS);
  let file: string;
  try {
    file = ledgerDatabaseFile(mindRoot);
  } catch {
    return openMindosMemoryDatabase(MEMORY_DB_KEY, MIGRATIONS);
  }
  return options.create
    ? openMindosDatabase({ file, migrations: MIGRATIONS })
    : openMindosDatabaseIfExists({ file, migrations: MIGRATIONS });
}

export function rowOwner(row: RunRow): RunOwner {
  return row.owner_pid === null || row.owner_start_ts === null
    ? null
    : { pid: Number(row.owner_pid), startTs: Number(row.owner_start_ts) };
}

export function parseRunRow(row: RunRow): AgentRunRecord | null {
  try {
    return JSON.parse(row.run_json) as AgentRunRecord;
  } catch {
    return null;
  }
}

export function upsertRun(
  db: MindosDatabase,
  record: AgentRunRecord,
  owner: RunOwner,
  updatedAt: number,
  options: { onlyIfNewer?: boolean } = {},
): void {
  db.prepare(`
    INSERT INTO agent_runs(
      id, root_run_id, parent_run_id, chat_session_id, agent_kind, runtime_id, status,
      started_at, completed_at, updated_at, owner_pid, owner_start_ts, run_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      root_run_id = excluded.root_run_id,
      parent_run_id = excluded.parent_run_id,
      chat_session_id = excluded.chat_session_id,
      agent_kind = excluded.agent_kind,
      runtime_id = excluded.runtime_id,
      status = excluded.status,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at,
      owner_pid = excluded.owner_pid,
      owner_start_ts = excluded.owner_start_ts,
      run_json = excluded.run_json
    ${options.onlyIfNewer ? 'WHERE excluded.updated_at >= agent_runs.updated_at' : ''}
  `).run(
    record.id,
    record.rootRunId ?? null,
    record.parentRunId ?? null,
    record.chatSessionId ?? null,
    record.agentKind,
    record.runtimeId,
    record.status,
    record.startedAt,
    record.completedAt ?? null,
    updatedAt,
    owner?.pid ?? null,
    owner?.startTs ?? null,
    JSON.stringify(record),
  );
}

export function readRunRow(db: MindosDatabase, id: string): RunRow | undefined {
  return db.prepare(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`).get(id) as RunRow | undefined;
}

/**
 * Rows matching every filter except `status` (which callers apply after the
 * orphan projection), newest-started first; ties resolve by insertion order
 * so a child run started in the same millisecond lists before its parent.
 */
export function listRunRows(db: MindosDatabase, options: ListAgentRunsOptions, limit: number | null): RunRow[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.runId) { where.push('id = ?'); params.push(options.runId); }
  if (options.rootRunId) { where.push('(root_run_id = ? OR id = ?)'); params.push(options.rootRunId, options.rootRunId); }
  if (options.kind) { where.push('agent_kind = ?'); params.push(options.kind); }
  if (options.parentRunId) { where.push('parent_run_id = ?'); params.push(options.parentRunId); }
  if (options.chatSessionId) { where.push('chat_session_id = ?'); params.push(options.chatSessionId); }
  if (options.startedAfter !== undefined) { where.push('started_at >= ?'); params.push(options.startedAfter); }
  let sql = `SELECT ${RUN_COLUMNS} FROM agent_runs ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC, rowid DESC`;
  if (limit !== null) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  return db.prepare(sql).all(...params) as unknown as RunRow[];
}

export function countRuns(db: MindosDatabase): number {
  const row = db.prepare('SELECT count(*) AS n FROM agent_runs').get() as { n: number };
  return Number(row.n);
}

/** Drops the oldest runs beyond MAX_RUNS together with their events. */
export function pruneRuns(db: MindosDatabase): void {
  if (countRuns(db) <= MAX_RUNS) return;
  const overflow = 'SELECT id FROM agent_runs ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET ?';
  db.prepare(`DELETE FROM agent_run_events WHERE run_id IN (${overflow})`).run(MAX_RUNS);
  db.prepare(`DELETE FROM agent_runs WHERE id IN (${overflow})`).run(MAX_RUNS);
}

export function insertEventRow(db: MindosDatabase, event: AgentEvent): void {
  db.prepare(`
    INSERT INTO agent_run_events(id, run_id, root_run_id, chat_session_id, ts, type, category, visibility, run_started_at, event_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.runId,
    event.record.rootRunId ?? null,
    event.record.chatSessionId ?? null,
    event.ts,
    event.type,
    event.category,
    event.visibility ?? 'timeline',
    event.record.startedAt,
    storedEventJson(event),
  );
}

/**
 * Event types whose row keeps a snapshot of the run record: they describe a
 * state transition (or an approval gate) and the record as it was at that
 * moment is part of the evidence. Every other row drops the record and gets
 * it back from `agent_runs` on read, so a token delta costs bytes for its text
 * only.
 */
const RECORD_SNAPSHOT_EVENT_TYPES: ReadonlySet<AgentEventType> = new Set<AgentEventType>([
  'run_started',
  'run_updated',
  'run_completed',
  'run_failed',
  'run_canceled',
  'permission',
  'permission_requested',
  'permission_resolved',
]);

export function storedEventJson(event: AgentEvent): string {
  if (RECORD_SNAPSHOT_EVENT_TYPES.has(event.type)) return JSON.stringify(event);
  const { record: _record, ...payload } = event;
  return JSON.stringify(payload);
}

export function listEventRows(db: MindosDatabase, options: ListAgentEventsOptions, limit: number): AgentEvent[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.runId) { where.push('e.run_id = ?'); params.push(options.runId); }
  if (options.rootRunId) { where.push('(e.root_run_id = ? OR e.run_id = ?)'); params.push(options.rootRunId, options.rootRunId); }
  if (options.chatSessionId) { where.push('e.chat_session_id = ?'); params.push(options.chatSessionId); }
  if (options.type) { where.push('e.type = ?'); params.push(options.type); }
  if (options.category) { where.push('e.category = ?'); params.push(options.category); }
  if (options.visibility) { where.push('e.visibility = ?'); params.push(options.visibility); }
  if (options.startedAfter !== undefined) {
    where.push('(e.ts >= ? OR e.run_started_at >= ?)');
    params.push(options.startedAfter, options.startedAfter);
  }
  params.push(limit);
  const rows = db.prepare(`
    SELECT e.event_json AS event_json, e.run_id AS run_id, r.run_json AS run_json
    FROM agent_run_events e LEFT JOIN agent_runs r ON r.id = e.run_id
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.seq DESC LIMIT ?
  `).all(...params) as Array<{ event_json: string; run_id: string; run_json: string | null }>;
  const events: AgentEvent[] = [];
  // One parse per run per listing: a run's events share the same record.
  const recordsByRun = new Map<string, AgentRunRecord | null>();
  for (const row of rows) {
    let event: AgentEvent;
    try {
      event = JSON.parse(row.event_json) as AgentEvent;
    } catch {
      // A corrupt row must not poison the whole listing.
      continue;
    }
    if (!event.record) {
      let record = recordsByRun.get(row.run_id);
      if (record === undefined) {
        record = row.run_json ? parseRunRow({ run_json: row.run_json } as RunRow) : null;
        recordsByRun.set(row.run_id, record);
      }
      // Events are deleted together with their run, so a missing run row
      // means the listing raced a prune; the event has no record to offer.
      if (!record) continue;
      event.record = record;
    }
    events.push(event);
  }
  return events;
}

/** Keeps the newest MAX_EVENTS_PER_RUN_VISIBILITY events of one run and visibility class. */
export function pruneRunEvents(db: MindosDatabase, runId: string, visibility: AgentEventVisibility): void {
  db.prepare(`
    DELETE FROM agent_run_events
    WHERE run_id = ? AND visibility = ? AND seq < (
      SELECT seq FROM agent_run_events WHERE run_id = ? AND visibility = ?
      ORDER BY seq DESC LIMIT 1 OFFSET ?
    )
  `).run(runId, visibility, runId, visibility, MAX_EVENTS_PER_RUN_VISIBILITY - 1);
}

/** Test-only: empties every ledger table (runs, events, artifacts). */
export function clearLedger(db: MindosDatabase): void {
  db.transaction(() => {
    db.exec('DELETE FROM agent_run_events');
    db.exec('DELETE FROM agent_runs');
    db.exec('DELETE FROM agent_artifacts');
  });
}
