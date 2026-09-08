import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  openMindosDatabase,
  openMindosDatabaseIfExists,
  type MindosDatabase,
  type MindosDatabaseMigration,
} from '../../foundation/storage/sqlite.js';

/**
 * SQLite index over the capsule files (spec-sqlite-derived-stores).
 *
 * The 0600 JSON files under `.mindos/agent-run-capsules/YYYY/MM/` stay the
 * source of truth; this index only remembers where each capsule lives and the
 * few fields list/get need, so lookups by id never probe directories and a
 * list never re-scans a month whose directory mtime has not changed. Rows are
 * validated against the file's mtime/size on every use and rebuilt from the
 * directory when missing or stale, so deleting the database loses nothing.
 */

export const CAPSULES_DB_RELATIVE_PATH = '.mindos/db/capsules_1.sqlite';

const MIGRATIONS: MindosDatabaseMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE capsules(
        id TEXT PRIMARY KEY,
        run_id TEXT,
        root_run_id TEXT,
        chat_session_id TEXT,
        status TEXT,
        created_at TEXT,
        updated_at TEXT,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        corrupt_message TEXT
      );
      CREATE INDEX idx_capsules_created ON capsules(created_at DESC);
      CREATE INDEX idx_capsules_run ON capsules(run_id);
      CREATE TABLE capsule_dirs(path TEXT PRIMARY KEY, mtime_ms REAL NOT NULL);
    `,
  },
];

export interface CapsuleIndexRow {
  id: string;
  run_id: string | null;
  root_run_id: string | null;
  chat_session_id: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Posix path relative to the mind root. */
  path: string;
  size: number;
  mtime_ms: number;
  corrupt_message: string | null;
}

const ROW_COLUMNS = 'id, run_id, root_run_id, chat_session_id, status, created_at, updated_at, path, size, mtime_ms, corrupt_message';

export function capsuleIndexFile(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, CAPSULES_DB_RELATIVE_PATH);
}

/** Read paths pass `create: false` and get null while no index exists yet. */
export function openCapsuleIndex(mindRoot: string, options: { create: boolean }): MindosDatabase | null {
  const file = capsuleIndexFile(mindRoot);
  return options.create
    ? openMindosDatabase({ file, migrations: MIGRATIONS })
    : openMindosDatabaseIfExists({ file, migrations: MIGRATIONS });
}

export function upsertCapsuleRow(db: MindosDatabase, row: CapsuleIndexRow): void {
  db.prepare(`
    INSERT INTO capsules(${ROW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      run_id = excluded.run_id,
      root_run_id = excluded.root_run_id,
      chat_session_id = excluded.chat_session_id,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      path = excluded.path,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      corrupt_message = excluded.corrupt_message
  `).run(
    row.id,
    row.run_id,
    row.root_run_id,
    row.chat_session_id,
    row.status,
    row.created_at,
    row.updated_at,
    row.path,
    row.size,
    row.mtime_ms,
    row.corrupt_message,
  );
}

export function deleteCapsuleRow(db: MindosDatabase, id: string): void {
  db.prepare('DELETE FROM capsules WHERE id = ?').run(id);
}

export function getCapsuleRow(db: MindosDatabase, id: string): CapsuleIndexRow | undefined {
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM capsules WHERE id = ?`).get(id) as unknown as CapsuleIndexRow | undefined;
}

/** Every indexed capsule, newest first; corrupt rows (no created_at) sort last. */
export function listCapsuleRows(db: MindosDatabase): CapsuleIndexRow[] {
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM capsules ORDER BY created_at DESC, id ASC`).all() as unknown as CapsuleIndexRow[];
}

/** Rows filed under one month directory (relative posix prefix, e.g. `.../2026/09`). */
export function listCapsuleRowsUnder(db: MindosDatabase, dirRelativePath: string): CapsuleIndexRow[] {
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM capsules WHERE path LIKE ? ESCAPE '\\'`)
    .all(`${dirRelativePath.replace(/[\\%_]/g, (char) => `\\${char}`)}/%`) as unknown as CapsuleIndexRow[];
}

export function readDirMtime(db: MindosDatabase, dirRelativePath: string): number | undefined {
  const row = db.prepare('SELECT mtime_ms FROM capsule_dirs WHERE path = ?').get(dirRelativePath) as { mtime_ms: number } | undefined;
  return row ? Number(row.mtime_ms) : undefined;
}

export function writeDirMtime(db: MindosDatabase, dirRelativePath: string, mtimeMs: number): void {
  db.prepare('INSERT INTO capsule_dirs(path, mtime_ms) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms')
    .run(dirRelativePath, mtimeMs);
}

export function listIndexedDirs(db: MindosDatabase): string[] {
  return (db.prepare('SELECT path FROM capsule_dirs').all() as Array<{ path: string }>).map((row) => row.path);
}

/** Forgets a month directory and every capsule row filed under it. */
export function forgetDir(db: MindosDatabase, dirRelativePath: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM capsules WHERE path LIKE ? ESCAPE '\\'`)
      .run(`${dirRelativePath.replace(/[\\%_]/g, (char) => `\\${char}`)}/%`);
    db.prepare('DELETE FROM capsule_dirs WHERE path = ?').run(dirRelativePath);
  });
}

export function clearCapsuleIndex(db: MindosDatabase): void {
  db.transaction(() => {
    db.exec('DELETE FROM capsules');
    db.exec('DELETE FROM capsule_dirs');
  });
}
