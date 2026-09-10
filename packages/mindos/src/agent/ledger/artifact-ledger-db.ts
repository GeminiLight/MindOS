import fs from 'node:fs';
import path from 'node:path';
import type { MindosDatabase } from '../../foundation/storage/sqlite.js';
import {
  isDeadOwner,
  ledgerDirPath,
  renameLegacyFileToMigrated,
  type RunOwner,
} from './run-ledger-legacy-import.js';
import type { AgentArtifactLedgerRecord, ListAgentArtifactsOptions } from './artifact-ledger.js';

/**
 * Row access for the artifact pointer index, table `agent_artifacts` in the
 * run ledger database (spec-ledger-write-cost P2), plus the one-time import
 * of the pre-spec per-process JSONL shards
 * (`<mindRoot>/.mindos/agent-artifact-ledger.<pid>-<startTs>.jsonl`).
 */

export const MAX_ARTIFACTS = 1000;
/** Pruning is amortized: run it once per this many appends. */
export const ARTIFACT_TRIM_SLACK = 50;
export const ARTIFACT_SHARD_FILE_PATTERN = /^agent-artifact-ledger\.(\d+)-(\d+)\.jsonl$/;
/** Every legacy artifact shard, including already-migrated copies. */
export const LEGACY_ARTIFACT_FILE_PATTERN = /^agent-artifact-ledger\./;

const ARTIFACT_COLUMNS = 'id, runtime_id, agent_kind, source, kind, status, session_id, external_session_id, run_id, tool_call_id, created_at, updated_at, artifact_json';

export function readArtifactRow(db: MindosDatabase, id: string): AgentArtifactLedgerRecord | undefined {
  const row = db.prepare('SELECT artifact_json FROM agent_artifacts WHERE id = ?').get(id) as { artifact_json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.artifact_json) as AgentArtifactLedgerRecord;
  } catch {
    return undefined;
  }
}

export function upsertArtifact(
  db: MindosDatabase,
  record: AgentArtifactLedgerRecord,
  options: { onlyIfNewer?: boolean } = {},
): void {
  db.prepare(`
    INSERT INTO agent_artifacts(${ARTIFACT_COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      runtime_id = excluded.runtime_id,
      agent_kind = excluded.agent_kind,
      source = excluded.source,
      kind = excluded.kind,
      status = excluded.status,
      session_id = excluded.session_id,
      external_session_id = excluded.external_session_id,
      run_id = excluded.run_id,
      tool_call_id = excluded.tool_call_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      artifact_json = excluded.artifact_json
    ${options.onlyIfNewer ? 'WHERE excluded.updated_at >= agent_artifacts.updated_at' : ''}
  `).run(
    record.id,
    record.runtimeId,
    record.agentKind,
    record.source,
    record.kind,
    record.status,
    record.sessionId ?? null,
    record.externalSessionId ?? null,
    record.runId ?? null,
    record.toolCallId ?? null,
    record.createdAt,
    record.updatedAt,
    JSON.stringify(record),
  );
}

/** Rows matching every filter, most recently updated first. */
export function listArtifactRows(db: MindosDatabase, options: ListAgentArtifactsOptions, limit: number): AgentArtifactLedgerRecord[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.runtimeId) { where.push('runtime_id = ?'); params.push(options.runtimeId); }
  if (options.sessionId) { where.push('session_id = ?'); params.push(options.sessionId); }
  if (options.externalSessionId) { where.push('external_session_id = ?'); params.push(options.externalSessionId); }
  if (options.runId) { where.push('run_id = ?'); params.push(options.runId); }
  if (options.toolCallId) { where.push('tool_call_id = ?'); params.push(options.toolCallId); }
  if (options.kind) { where.push('kind = ?'); params.push(options.kind); }
  if (options.source) { where.push('source = ?'); params.push(options.source); }
  params.push(limit);
  const rows = db.prepare(`
    SELECT artifact_json FROM agent_artifacts
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY updated_at DESC, rowid DESC LIMIT ?
  `).all(...params) as Array<{ artifact_json: string }>;
  const records: AgentArtifactLedgerRecord[] = [];
  for (const row of rows) {
    try {
      records.push(JSON.parse(row.artifact_json) as AgentArtifactLedgerRecord);
    } catch {
      // A corrupt row must not poison the whole listing.
    }
  }
  return records;
}

export function countArtifacts(db: MindosDatabase): number {
  const row = db.prepare('SELECT count(*) AS n FROM agent_artifacts').get() as { n: number };
  return Number(row.n);
}

/** Drops the oldest-created artifacts beyond MAX_ARTIFACTS. */
export function pruneArtifacts(db: MindosDatabase): void {
  if (countArtifacts(db) <= MAX_ARTIFACTS) return;
  db.prepare(`
    DELETE FROM agent_artifacts WHERE id IN (
      SELECT id FROM agent_artifacts ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
    )
  `).run(MAX_ARTIFACTS);
}

// --- legacy shard import ---

type LegacyShardFile = { file: string; owner: RunOwner };

function listLegacyShards(mindRoot: string): LegacyShardFile[] {
  const dir = ledgerDirPath(mindRoot);
  if (!dir || !fs.existsSync(dir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const shards: Array<LegacyShardFile & { pid: number; startTs: number }> = [];
  for (const name of names) {
    const match = ARTIFACT_SHARD_FILE_PATTERN.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    const startTs = Number(match[2]);
    shards.push({ file: path.join(dir, name), owner: { pid, startTs }, pid, startTs });
  }
  // Deterministic merge order so every importer resolves ties identically.
  shards.sort((a, b) => (a.startTs - b.startTs) || (a.pid - b.pid));
  return shards.map(({ file, owner }) => ({ file, owner }));
}

export function hasLegacyArtifactShards(mindRoot: string): boolean {
  return listLegacyShards(mindRoot).length > 0;
}

/**
 * Imports every legacy shard into `agent_artifacts` (latest `updatedAt` per
 * id wins, never overwriting a newer row already in the table), then renames
 * the shards whose owner process is gone to `*.migrated`. A shard whose owner
 * is still alive is left in place and re-imported on the next open, because
 * that process may still be appending to it during an upgrade window.
 */
export function importLegacyArtifactShards(
  db: MindosDatabase,
  mindRoot: string,
  self: { pid: number; startTs: number },
  normalize: (value: unknown) => AgentArtifactLedgerRecord | null,
): void {
  const shards = listLegacyShards(mindRoot);
  if (shards.length === 0) return;
  const latest = new Map<string, AgentArtifactLedgerRecord>();
  for (const shard of shards) {
    let lines: string[];
    try {
      lines = fs.readFileSync(shard.file, 'utf-8').split('\n');
    } catch {
      // A torn or unreadable shard must never block artifact projection.
      continue;
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let op: { version?: unknown; type?: unknown; record?: unknown };
      try {
        op = JSON.parse(trimmed) as { version?: unknown; type?: unknown; record?: unknown };
      } catch {
        continue;
      }
      if (op.version !== 1 || op.type !== 'artifact_upsert') continue;
      const record = normalize(op.record);
      if (!record) continue;
      const existing = latest.get(record.id);
      if (!existing || record.updatedAt >= existing.updatedAt) latest.set(record.id, record);
    }
  }
  try {
    db.transaction(() => {
      for (const record of latest.values()) upsertArtifact(db, record, { onlyIfNewer: true });
      pruneArtifacts(db);
    });
  } catch {
    // Unreadable legacy data must never block the ledger.
    return;
  }
  for (const shard of shards) {
    if (isDeadOwner(shard.owner, self)) renameLegacyFileToMigrated(shard.file);
  }
}

/** Test-only: deletes every legacy artifact shard (originals and `*.migrated` copies). */
export function removeLegacyArtifactFiles(mindRoot: string): void {
  const dir = ledgerDirPath(mindRoot);
  if (!dir || !fs.existsSync(dir)) return;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (LEGACY_ARTIFACT_FILE_PATTERN.test(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    // Test cleanup is best-effort.
  }
}
