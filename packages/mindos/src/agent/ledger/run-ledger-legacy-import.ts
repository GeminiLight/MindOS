import fs from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { normalizeEvent, normalizeRecord, recordWriteTs } from './run-ledger-normalize.js';
import type { AgentEvent, AgentRunRecord } from './run-ledger-types.js';

/**
 * Read-only readers for the pre-SQLite ledger formats
 * (spec-sqlite-derived-stores, migration section):
 *
 * - v1 `agent-run-ledger.json`  — one JSON document `{ records, events }`
 * - v2 `agent-run-ledger.jsonl` — global op log (`record_upsert` / `event_append` / `compact` / `reset`)
 * - v3 `agent-run-ledger.<pid>-<startTs>.jsonl` — one op-log shard per process
 *
 * Everything found is imported into `agent_runs_1.sqlite` on open. Files whose
 * owning process is gone (and the ownerless v1/v2 files) are then renamed to
 * `*.migrated`; a shard whose owner is still alive is left in place and
 * re-imported on the next open, because that process may still be appending
 * to it during an upgrade window.
 */

export const LEDGER_DIR_NAME = '.mindos';
export const LEDGER_LEGACY_JSON_NAME = 'agent-run-ledger.json';
export const LEDGER_LEGACY_JSONL_NAME = 'agent-run-ledger.jsonl';
export const SHARD_FILE_PATTERN = /^agent-run-ledger\.(\d+)-(\d+)\.jsonl$/;
/** Every legacy ledger artifact, including already-migrated copies. */
export const LEGACY_LEDGER_FILE_PATTERN = /^agent-run-ledger\./;

export type RunOwner = { pid: number; startTs: number } | null;

export interface LegacyRunEntry {
  record: AgentRunRecord;
  /** Write timestamp used for last-write-wins merging. */
  ts: number;
  owner: RunOwner;
}

export interface LegacyLedgerFiles {
  runs: LegacyRunEntry[];
  events: AgentEvent[];
  files: Array<{ file: string; owner: RunOwner }>;
}

interface LegacyPersistedAgentRunLedger {
  version: 1;
  records: AgentRunRecord[];
  events: AgentEvent[];
}

type LegacyPersistedOperation =
  | { version: 2; type: 'compact'; records: AgentRunRecord[]; events: AgentEvent[] }
  | { version: 2; type: 'record_upsert'; record: AgentRunRecord }
  | { version: 2; type: 'event_append'; event: AgentEvent }
  | { version: 2; type: 'reset' };

type ShardOperation =
  | { version: 3; type: 'record_upsert'; ts: number; record: AgentRunRecord }
  | { version: 3; type: 'compact'; ts: number; records: AgentRunRecord[] };

export function ledgerDirPath(mindRoot: string): string | null {
  try {
    return resolveExistingSafe(mindRoot, LEDGER_DIR_NAME);
  } catch {
    return null;
  }
}

export function hasLegacyLedgerFiles(mindRoot: string): boolean {
  const dir = ledgerDirPath(mindRoot);
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir).some((name) => (
      name === LEDGER_LEGACY_JSON_NAME || name === LEDGER_LEGACY_JSONL_NAME || SHARD_FILE_PATTERN.test(name)
    ));
  } catch {
    return false;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = exists but owned by another user; anything else (ESRCH) = gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether the process that wrote a record can still progress it. Ownerless
 * (legacy) records are always dead; a recycled pid with a different start
 * timestamp is a previous incarnation and therefore dead too.
 */
export function isDeadOwner(owner: RunOwner, self: { pid: number; startTs: number }): boolean {
  if (!owner) return true;
  if (owner.pid === self.pid) return owner.startTs !== self.startTs;
  return !isPidAlive(owner.pid);
}

export function renameLegacyFileToMigrated(file: string): void {
  try {
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.migrated`);
  } catch {
    // Another process may have renamed it first; the import is idempotent.
  }
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf-8').split('\n').map((line) => line.trim()).filter(Boolean);
}

function readLegacyJson(file: string, out: LegacyLedgerFiles): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<LegacyPersistedAgentRunLedger>;
    for (const value of Array.isArray(parsed.records) ? parsed.records : []) {
      const record = normalizeRecord(value);
      if (record) out.runs.push({ record, ts: recordWriteTs(record), owner: null });
    }
    for (const value of Array.isArray(parsed.events) ? parsed.events : []) {
      const event = normalizeEvent(value);
      if (event) out.events.push(event);
    }
    out.files.push({ file, owner: null });
  } catch {
    // Unreadable legacy data must never block the ledger.
  }
}

function readLegacyJsonl(file: string, out: LegacyLedgerFiles): void {
  try {
    // Replay the v2 op log into a local view first — later ops override
    // earlier ones within the file, independent of cross-source merge order.
    const local = new Map<string, AgentRunRecord>();
    const localEvents: AgentEvent[] = [];
    for (const line of readLines(file)) {
      let op: Partial<LegacyPersistedOperation>;
      try { op = JSON.parse(line) as Partial<LegacyPersistedOperation>; } catch { continue; }
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
      out.runs.push({ record, ts: recordWriteTs(record), owner: null });
    }
    out.events.push(...localEvents);
    out.files.push({ file, owner: null });
  } catch {
    // Unreadable legacy data must never block the ledger.
  }
}

function readShard(file: string, owner: { pid: number; startTs: number }, out: LegacyLedgerFiles): void {
  try {
    const local = new Map<string, { record: AgentRunRecord; ts: number }>();
    for (const line of readLines(file)) {
      let op: Partial<ShardOperation>;
      try { op = JSON.parse(line) as Partial<ShardOperation>; } catch { continue; }
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
      out.runs.push({ record, ts, owner });
    }
    out.files.push({ file, owner });
  } catch {
    // A torn or unreadable shard must never block the ledger.
  }
}

/** Reads every legacy ledger file under `<mindRoot>/.mindos` without modifying any of them. */
export function readLegacyLedgerFiles(mindRoot: string): LegacyLedgerFiles {
  const out: LegacyLedgerFiles = { runs: [], events: [], files: [] };
  const dir = ledgerDirPath(mindRoot);
  if (!dir || !fs.existsSync(dir)) return out;

  const legacyJson = path.join(dir, LEDGER_LEGACY_JSON_NAME);
  if (fs.existsSync(legacyJson)) readLegacyJson(legacyJson, out);
  const legacyJsonl = path.join(dir, LEDGER_LEGACY_JSONL_NAME);
  if (fs.existsSync(legacyJsonl)) readLegacyJsonl(legacyJsonl, out);

  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  const shards: Array<{ file: string; pid: number; startTs: number }> = [];
  for (const name of names) {
    const match = SHARD_FILE_PATTERN.exec(name);
    if (!match) continue;
    shards.push({ file: path.join(dir, name), pid: Number(match[1]), startTs: Number(match[2]) });
  }
  // Deterministic merge order so every importer resolves ties identically.
  shards.sort((a, b) => (a.startTs - b.startTs) || (a.pid - b.pid));
  for (const shard of shards) {
    readShard(shard.file, { pid: shard.pid, startTs: shard.startTs }, out);
  }
  // Legacy events come newest-first from disk; import oldest-first so `seq` follows time.
  out.events.sort((a, b) => a.ts - b.ts);
  return out;
}
