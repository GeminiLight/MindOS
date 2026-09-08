import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  escapeLikePattern,
  openMindosDatabase,
  openMindosDatabaseIfExists,
  type MindosDatabase,
  type MindosDatabaseMigration,
} from '../../foundation/storage/sqlite.js';
import type {
  ContentChangeEvent,
  ContentChangeInput,
  ContentChangeSource,
  ContentChangeSummary,
} from '../../knowledge/audit/index.js';
import { emitStudioAutomationEvent, recordStudioAutomationEventSourceFailure } from '../automations/events.js';
import { readJsonlEvents, readJsonlMeta } from './jsonl-log.js';

/**
 * Content change log backed by `node:sqlite` (spec-sqlite-derived-stores).
 *
 * This is the single implementation shared by the Product Server
 * (`handlers/changes.ts`), the Web writer (`packages/web/lib/core/content-changes.ts`
 * delegates here) and the `@geminilight/mindos/knowledge` audit facade.
 *
 * Storage: `<mindRoot>/.mindos/db/change_log_1.sqlite`. Events live in
 * `content_changes` with real indexed columns for the filters the UI uses and
 * a `meta_json` column that round-trips any extra fields; `change_log_state`
 * holds `lastSeenAt` and the legacy Agent-Diff import counter.
 *
 * Legacy `.mindos/change-log.json` (JSONL, or the older pretty-printed v1
 * document) plus `change-log.meta.json` are imported on first open and then
 * renamed to `*.migrated` so they are never read or written again.
 */

export const CHANGE_LOG_DB_RELATIVE_PATH = '.mindos/db/change_log_1.sqlite';

const MAX_EVENTS = 500;
const MAX_TEXT_CHARS = 12_000;
const LEGACY_LOG_FILE = '.mindos/change-log.json';
const LEGACY_META_FILE = '.mindos/change-log.meta.json';
const LEGACY_AGENT_DIFF_FILE = 'Agent-Diff.md';
const ROOT_SPACE_VALUE = '__root__';
const UNKNOWN_AGENT_VALUE = '__agent_unknown__';
const STATE_LAST_SEEN_AT = 'lastSeenAt';
const STATE_AGENT_DIFF_IMPORTED = 'agentDiffImportedCount';
const STATE_AGENT_DIFF_LAST_IMPORTED_AT = 'agentDiffLastImportedAt';

const MIGRATIONS: MindosDatabaseMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE content_changes(
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        ts TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        op TEXT NOT NULL,
        path TEXT NOT NULL,
        space TEXT NOT NULL,
        source TEXT NOT NULL,
        agent_name TEXT,
        agent_facet TEXT,
        summary TEXT NOT NULL,
        before_text TEXT,
        after_text TEXT,
        before_path TEXT,
        after_path TEXT,
        truncated INTEGER NOT NULL DEFAULT 0,
        search_text TEXT NOT NULL,
        meta_json TEXT
      );
      CREATE INDEX idx_content_changes_ts ON content_changes(ts_ms DESC, seq DESC);
      CREATE INDEX idx_content_changes_path ON content_changes(path, ts_ms DESC);
      CREATE TABLE change_log_state(key TEXT PRIMARY KEY, value TEXT);
    `,
  },
];

export interface ContentChangeListOptions {
  path?: string;
  space?: string;
  limit?: number;
  source?: ContentChangeSource;
  agent?: string;
  op?: string;
  q?: string;
}

export interface ContentChangeFacetItem {
  value: string;
  count: number;
}

export interface ContentChangeFacets {
  spaces: ContentChangeFacetItem[];
  agents: ContentChangeFacetItem[];
  operations: ContentChangeFacetItem[];
  sources: ContentChangeFacetItem[];
}

type ChangeRow = {
  id: string;
  ts: string;
  op: string;
  path: string;
  source: string;
  agent_name: string | null;
  summary: string;
  before_text: string | null;
  after_text: string | null;
  before_path: string | null;
  after_path: string | null;
  truncated: number;
  meta_json: string | null;
};

const KNOWN_EVENT_KEYS = new Set([
  'id', 'ts', 'op', 'path', 'source', 'summary', 'agentName', 'before', 'after', 'beforePath', 'afterPath', 'truncated',
]);

// --- paths ---

function nowIso(): string {
  return new Date().toISOString();
}

function resolveKnowledgePath(mindRoot: string, relativePath: string): string {
  if (existsSync(mindRoot)) {
    return resolveExistingSafe(mindRoot, relativePath);
  }
  return path.join(mindRoot, relativePath);
}

function databasePath(mindRoot: string): string {
  return resolveKnowledgePath(mindRoot, CHANGE_LOG_DB_RELATIVE_PATH);
}

// --- derived values (shared with the legacy implementations, kept verbatim) ---

function normalizeEventPath(value: string | undefined): string {
  return typeof value === 'string' ? value.split('\\').join('/').replace(/^\/+/, '').replace(/\/+$/, '') : '';
}

function pathSpaceValue(value: string | undefined, op?: string): string {
  const normalized = normalizeEventPath(value);
  if (!normalized) return ROOT_SPACE_VALUE;
  const [first, ...rest] = normalized.split('/');
  if (rest.length > 0) return first || ROOT_SPACE_VALUE;
  if (op === 'create_space' || op === 'rename_space') return first || ROOT_SPACE_VALUE;
  return ROOT_SPACE_VALUE;
}

function eventSpaceValue(event: ContentChangeEvent): string {
  const candidates = [event.afterPath, event.path, event.beforePath];
  for (const candidate of candidates) {
    const value = pathSpaceValue(candidate, event.op);
    if (value !== ROOT_SPACE_VALUE) return value;
  }
  return ROOT_SPACE_VALUE;
}

function eventAgentValue(event: ContentChangeEvent): string | null {
  if (event.source !== 'agent') return null;
  return event.agentName?.trim() || UNKNOWN_AGENT_VALUE;
}

function eventSearchText(event: ContentChangeEvent): string {
  return `${event.path} ${event.beforePath ?? ''} ${event.afterPath ?? ''} ${event.summary} ${event.op} ${event.source} ${event.agentName ?? ''}`.toLowerCase();
}

function normalizeText(value: string | undefined): { value: string | undefined; truncated: boolean } {
  if (typeof value !== 'string') return { value: undefined, truncated: false };
  if (value.length <= MAX_TEXT_CHARS) return { value, truncated: false };
  return { value: value.slice(0, MAX_TEXT_CHARS), truncated: true };
}

function toValidIso(ts: string | undefined): string {
  if (!ts) return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

function tsMillis(ts: string): number {
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// --- rows <-> events ---

function rowToEvent(row: ChangeRow): ContentChangeEvent {
  const extra = row.meta_json ? safeParseObject(row.meta_json) : null;
  const event: ContentChangeEvent = {
    ...(extra ?? {}),
    id: row.id,
    ts: row.ts,
    op: row.op,
    path: row.path,
    source: row.source as ContentChangeSource,
    summary: row.summary,
  } as ContentChangeEvent;
  if (row.agent_name !== null) event.agentName = row.agent_name;
  if (row.before_text !== null) event.before = row.before_text;
  if (row.after_text !== null) event.after = row.after_text;
  if (row.before_path !== null) event.beforePath = row.before_path;
  if (row.after_path !== null) event.afterPath = row.after_path;
  if (row.truncated) event.truncated = true;
  return event;
}

function safeParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function insertEvent(db: MindosDatabase, event: ContentChangeEvent): void {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!KNOWN_EVENT_KEYS.has(key) && value !== undefined) extra[key] = value;
  }
  db.prepare(`
    INSERT INTO content_changes(
      id, ts, ts_ms, op, path, space, source, agent_name, agent_facet, summary,
      before_text, after_text, before_path, after_path, truncated, search_text, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.ts,
    tsMillis(event.ts),
    event.op,
    event.path,
    eventSpaceValue(event),
    event.source,
    event.agentName ?? null,
    eventAgentValue(event),
    event.summary,
    event.before ?? null,
    event.after ?? null,
    event.beforePath ?? null,
    event.afterPath ?? null,
    event.truncated ? 1 : 0,
    eventSearchText(event),
    Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
  );
}

/**
 * Retention is by row count only. An age cutoff was considered and rejected:
 * legacy imports (Agent-Diff.md, old JSONL) carry arbitrary historical
 * timestamps and would be dropped on arrival, and the count cap already
 * bounds the file size.
 */
function pruneEvents(db: MindosDatabase): void {
  db.prepare(`
    DELETE FROM content_changes
    WHERE seq NOT IN (SELECT seq FROM content_changes ORDER BY ts_ms DESC, seq DESC LIMIT ?)
  `).run(MAX_EVENTS);
}

function readState(db: MindosDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM change_log_state WHERE key = ?').get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

function writeState(db: MindosDatabase, key: string, value: string | null): void {
  db.prepare('INSERT INTO change_log_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function isValidEvent(value: unknown): value is ContentChangeEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ContentChangeEvent>;
  return typeof event.id === 'string'
    && typeof event.ts === 'string'
    && typeof event.op === 'string'
    && typeof event.path === 'string'
    && typeof event.source === 'string'
    && typeof event.summary === 'string';
}

// --- legacy import ---

function renameToMigrated(file: string): void {
  try {
    if (existsSync(file)) renameSync(file, `${file}.migrated`);
  } catch {
    // Another process may have renamed it first; the import is idempotent.
  }
}

/**
 * Imports `.mindos/change-log.json` (+ meta sidecar) into the database and
 * renames both to `*.migrated`. `readJsonlEvents` transparently handles the
 * pretty-printed v1 document as well as JSONL and skips corrupt lines.
 */
function importLegacyLogIfNeeded(mindRoot: string, db: MindosDatabase): void {
  const logFile = resolveKnowledgePath(mindRoot, LEGACY_LOG_FILE);
  const metaFile = resolveKnowledgePath(mindRoot, LEGACY_META_FILE);
  const hasLog = existsSync(logFile);
  const hasMeta = existsSync(metaFile);
  if (!hasLog && !hasMeta) return;

  const { events, meta } = hasLog
    ? readJsonlEvents(logFile, metaFile)
    : { events: [] as unknown[], meta: readJsonlMeta(metaFile) };
  db.transaction(() => {
    // Newest-first from the reader; insert oldest-first so `seq` follows time.
    for (const value of [...events].reverse()) {
      if (isValidEvent(value)) insertEvent(db, value);
    }
    if (meta) {
      if (meta.lastSeenAt && readState(db, STATE_LAST_SEEN_AT) === null) {
        writeState(db, STATE_LAST_SEEN_AT, meta.lastSeenAt);
      }
      const imported = meta.legacy.agentDiffImportedCount;
      if (typeof imported === 'number' && readState(db, STATE_AGENT_DIFF_IMPORTED) === null) {
        writeState(db, STATE_AGENT_DIFF_IMPORTED, String(imported));
      }
    }
    pruneEvents(db);
  });
  renameToMigrated(logFile);
  renameToMigrated(metaFile);
}

interface LegacyAgentDiffEntry {
  ts?: string;
  path?: string;
  tool?: string;
  before?: string;
  after?: string;
}

function parseLegacyAgentDiffBlocks(content: string): LegacyAgentDiffEntry[] {
  const blocks: LegacyAgentDiffEntry[] = [];
  const re = /```agent-diff\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1]) continue;
    try {
      blocks.push(JSON.parse(m[1].trim()) as LegacyAgentDiffEntry);
    } catch {
      // Skip malformed block, keep import best-effort.
    }
  }
  return blocks;
}

function importLegacyAgentDiffIfNeeded(mindRoot: string, db: MindosDatabase): void {
  try {
    const legacyPath = resolveKnowledgePath(mindRoot, LEGACY_AGENT_DIFF_FILE);
    if (!existsSync(legacyPath)) return;
    const blocks = parseLegacyAgentDiffBlocks(readFileSync(legacyPath, 'utf-8'));
    if (blocks.length === 0) return;
    const importedCount = Number(readState(db, STATE_AGENT_DIFF_IMPORTED) ?? '0') || 0;
    if (blocks.length > importedCount) {
      db.transaction(() => {
        blocks.slice(importedCount).forEach((entry, idx) => {
          const before = normalizeText(entry.before);
          const after = normalizeText(entry.after);
          const toolName = typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool';
          insertEvent(db, {
            id: `legacy-${Date.now().toString(36)}-${idx.toString(36)}`,
            ts: toValidIso(entry.ts),
            op: 'legacy_agent_diff_import',
            path: typeof entry.path === 'string' && entry.path.trim() ? entry.path : LEGACY_AGENT_DIFF_FILE,
            source: 'agent',
            summary: `Imported legacy agent diff (${toolName})`,
            before: before.value,
            after: after.value,
            truncated: before.truncated || after.truncated || undefined,
          });
        });
        writeState(db, STATE_AGENT_DIFF_IMPORTED, String(blocks.length));
        writeState(db, STATE_AGENT_DIFF_LAST_IMPORTED_AT, nowIso());
        pruneEvents(db);
      });
    }
    rmSync(legacyPath, { force: true });
  } catch {
    // Legacy import is best-effort and must never break the main flow.
  }
}

// --- store access ---

function hasLegacyInput(mindRoot: string): boolean {
  try {
    return existsSync(resolveKnowledgePath(mindRoot, LEGACY_LOG_FILE))
      || existsSync(resolveKnowledgePath(mindRoot, LEGACY_META_FILE))
      || existsSync(resolveKnowledgePath(mindRoot, LEGACY_AGENT_DIFF_FILE));
  } catch {
    return false;
  }
}

/**
 * Opens the store. Read paths pass `create: false`, which never creates the
 * database unless legacy files are waiting to be imported; the caller gets
 * null when there is simply nothing to read yet.
 */
function openStore(mindRoot: string, options: { create: boolean }): MindosDatabase | null {
  const file = databasePath(mindRoot);
  const db = options.create || hasLegacyInput(mindRoot)
    ? openMindosDatabase({ file, migrations: MIGRATIONS })
    : openMindosDatabaseIfExists({ file, migrations: MIGRATIONS });
  if (!db) return null;
  importLegacyLogIfNeeded(mindRoot, db);
  importLegacyAgentDiffIfNeeded(mindRoot, db);
  return db;
}

// --- public API ---

/** Appends one change event (single INSERT) and projects it to the automation queue. */
export function appendContentChangeToLog(mindRoot: string, input: ContentChangeInput): ContentChangeEvent {
  const db = openStore(mindRoot, { create: true });
  if (!db) throw new Error('Content change log is unavailable.');
  const before = normalizeText(input.before);
  const after = normalizeText(input.after);
  const event: ContentChangeEvent = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: nowIso(),
    op: input.op,
    path: input.path,
    source: input.source,
    summary: input.summary,
    agentName: input.source === 'agent' && input.agentName?.trim() ? input.agentName.trim() : undefined,
    before: before.value,
    after: after.value,
    beforePath: input.beforePath,
    afterPath: input.afterPath,
    truncated: before.truncated || after.truncated || undefined,
  };
  db.transaction(() => {
    insertEvent(db, event);
    pruneEvents(db);
  });
  try {
    emitStudioAutomationEvent(mindRoot, {
      source: 'knowledge',
      key: event.id,
      type: 'knowledge.changed',
      occurredAt: new Date(event.ts),
      payload: {
        changeId: event.id,
        path: event.path,
        op: event.op,
        source: event.source,
        summary: event.summary,
        agentName: event.agentName,
        beforePath: event.beforePath,
        afterPath: event.afterPath,
      },
    });
  } catch (error) {
    recordStudioAutomationEventSourceFailure(mindRoot, { source: 'knowledge', key: event.id, error });
    // The change log remains authoritative if the automation projection is unavailable.
  }
  return event;
}

export function listContentChangesFromLog(
  mindRoot: string,
  options: ContentChangeListOptions = {},
): ContentChangeEvent[] {
  try {
    const db = openStore(mindRoot, { create: false });
    if (!db) return [];
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const where: string[] = [];
    const params: Array<string | number> = [];
    const pathFilter = options.path?.trim();
    if (pathFilter) {
      where.push('(path = ? OR before_path = ? OR after_path = ?)');
      params.push(pathFilter, pathFilter, pathFilter);
    }
    const spaceFilter = options.space?.trim();
    if (spaceFilter) {
      where.push('space = ?');
      params.push(spaceFilter);
    }
    if (options.source) {
      where.push('source = ?');
      params.push(options.source);
    }
    const agentFilter = options.agent?.trim();
    if (agentFilter) {
      where.push('agent_facet = ?');
      params.push(agentFilter);
    }
    const opFilter = options.op?.trim();
    if (opFilter) {
      where.push('op = ?');
      params.push(opFilter);
    }
    const q = options.q?.trim().toLowerCase();
    if (q) {
      where.push("search_text LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLikePattern(q)}%`);
    }
    const sql = `
      SELECT id, ts, op, path, source, agent_name, summary, before_text, after_text, before_path, after_path, truncated, meta_json
      FROM content_changes
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ts_ms DESC, seq DESC
      LIMIT ?
    `;
    params.push(limit);
    return (db.prepare(sql).all(...params) as ChangeRow[]).map(rowToEvent);
  } catch {
    return [];
  }
}

function facet(db: MindosDatabase, column: string, whereClause = ''): ContentChangeFacetItem[] {
  const rows = db.prepare(`SELECT ${column} AS value, count(*) AS count FROM content_changes ${whereClause} GROUP BY ${column}`)
    .all() as Array<{ value: string | null; count: number }>;
  return rows
    .filter((row): row is { value: string; count: number } => typeof row.value === 'string' && row.value.length > 0)
    .map((row) => ({ value: row.value, count: Number(row.count) }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function getContentChangeFacetsFromLog(mindRoot: string): ContentChangeFacets {
  try {
    const db = openStore(mindRoot, { create: false });
    if (!db) return { spaces: [], agents: [], operations: [], sources: [] };
    return {
      spaces: facet(db, 'space'),
      agents: facet(db, 'agent_facet', 'WHERE agent_facet IS NOT NULL'),
      operations: facet(db, 'op'),
      sources: facet(db, 'source'),
    };
  } catch {
    return { spaces: [], agents: [], operations: [], sources: [] };
  }
}

export function getContentChangeSummaryFromLog(mindRoot: string): ContentChangeSummary {
  try {
    const db = openStore(mindRoot, { create: false });
    if (!db) return { unreadCount: 0, totalCount: 0, lastSeenAt: null, latest: null };
    const lastSeenAt = readState(db, STATE_LAST_SEEN_AT);
    const lastSeenAtMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
    const totals = db.prepare('SELECT count(*) AS total, count(CASE WHEN ts_ms > ? THEN 1 END) AS unread FROM content_changes')
      .get(Number.isFinite(lastSeenAtMs) ? lastSeenAtMs : 0) as { total: number; unread: number };
    const latestRow = db.prepare(`
      SELECT id, ts, op, path, source, agent_name, summary, before_text, after_text, before_path, after_path, truncated, meta_json
      FROM content_changes ORDER BY ts_ms DESC, seq DESC LIMIT 1
    `).get() as ChangeRow | undefined;
    return {
      unreadCount: Number(totals.unread),
      totalCount: Number(totals.total),
      lastSeenAt,
      latest: latestRow ? rowToEvent(latestRow) : null,
    };
  } catch {
    return { unreadCount: 0, totalCount: 0, lastSeenAt: null, latest: null };
  }
}

/** Marks all changes seen by updating only the small state table. */
export function markContentChangesSeenInLog(mindRoot: string): void {
  const db = openStore(mindRoot, { create: true });
  if (!db) return;
  writeState(db, STATE_LAST_SEEN_AT, nowIso());
}
