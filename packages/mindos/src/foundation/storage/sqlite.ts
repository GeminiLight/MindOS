import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

/**
 * Shared `node:sqlite` helper for MindOS derived-state stores
 * (spec-sqlite-derived-stores).
 *
 * One database file per domain, named `<domain>_<schemaGeneration>.sqlite`,
 * opened in WAL mode so several MindOS processes (web server, MCP server,
 * headless CLI turns) can write concurrently with single-statement safety.
 * Schema changes within a generation go through the `_migrations` table;
 * breaking changes bump the file suffix instead and import from the old file.
 *
 * Handles are cached per resolved path for the lifetime of the process.
 *
 * `node:sqlite` is loaded through `process.getBuiltinModule` rather than a
 * static import: vite 5 (vitest) and webpack strip the `node:` prefix and do
 * not know `sqlite` as a builtin, so a static specifier fails module
 * resolution in tests and would need bundler-specific externals in Next.
 */

type SqliteModule = typeof import('node:sqlite');

let sqliteModule: SqliteModule | null = null;

function loadSqlite(): SqliteModule {
  if (sqliteModule) return sqliteModule;
  assertNodeRuntime();
  const loaded = typeof process.getBuiltinModule === 'function'
    ? (process.getBuiltinModule('node:sqlite') as SqliteModule | undefined)
    : undefined;
  if (!loaded || typeof loaded.DatabaseSync !== 'function') {
    throw new Error(`node:sqlite is not available in this runtime (Node >= 22.19 required, got ${process.version}).`);
  }
  sqliteModule = loaded;
  return loaded;
}

export interface MindosDatabaseMigration {
  /** Strictly ascending, starting at 1 for a fresh schema generation. */
  version: number;
  /** One or more SQL statements executed inside the migration transaction. */
  sql: string;
}

export interface OpenMindosDatabaseOptions {
  file: string;
  migrations: MindosDatabaseMigration[];
}

export interface MindosDatabase {
  readonly file: string;
  readonly isOpen: boolean;
  /** Prepared statements are cached per SQL string; treat them as shared. */
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
  /**
   * Runs `fn` inside `BEGIN IMMEDIATE ... COMMIT`; rolls back when it throws.
   * Nested calls join the enclosing transaction.
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}

const BUSY_TIMEOUT_MS = 5000;

const openDatabases = new Map<string, MindosDatabaseImpl>();
let exitHookInstalled = false;

class MindosDatabaseImpl implements MindosDatabase {
  readonly file: string;
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private transactionDepth = 0;
  private open = true;

  constructor(file: string, db: DatabaseSync) {
    this.file = file;
    this.db = db;
  }

  get isOpen(): boolean {
    return this.open;
  }

  prepare(sql: string): StatementSync {
    this.assertOpen();
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        return fn();
      } finally {
        this.transactionDepth -= 1;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The connection may already be out of the transaction (e.g. the
        // failing statement itself rolled back); the original error matters.
      }
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.statements.clear();
    openDatabases.delete(this.file);
    try {
      this.db.close();
    } catch {
      // Closing an already-broken handle must not throw at shutdown.
    }
  }

  private assertOpen(): void {
    if (!this.open) {
      throw new Error(`MindOS SQLite database is closed: ${this.file}`);
    }
  }
}

function assertNodeRuntime(): void {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
    throw new Error(
      'MindOS SQLite stores require the Node runtime (node:sqlite); '
      + 'the experimental Bun single-binary build is not supported yet.',
    );
  }
}

function validateMigrations(migrations: MindosDatabaseMigration[]): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previous) {
      throw new Error(
        `MindOS SQLite migrations must have strictly ascending integer versions (got ${migration.version} after ${previous}).`,
      );
    }
    if (typeof migration.sql !== 'string' || !migration.sql.trim()) {
      throw new Error(`MindOS SQLite migration ${migration.version} has no SQL.`);
    }
    previous = migration.version;
  }
}

function applyMigrations(db: DatabaseSync, migrations: MindosDatabaseMigration[]): void {
  // BEGIN IMMEDIATE takes the write lock up front, so two processes opening
  // the same fresh file serialize here and the second one sees every version
  // already recorded when it re-reads the table inside its own transaction.
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS _migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set<number>(
      (db.prepare('SELECT version FROM _migrations').all() as Array<{ version: number }>).map((row) => Number(row.version)),
    );
    const record = db.prepare('INSERT INTO _migrations(version, applied_at) VALUES (?, ?)');
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      db.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* connection already out of the transaction */ }
    throw error;
  }
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errcode = (error as { errcode?: unknown }).errcode;
  if (errcode === SQLITE_BUSY || errcode === SQLITE_LOCKED) return true;
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(error.message);
}

/**
 * Blocks the current thread for `ms`. Only used while opening a database, a
 * synchronous one-off bounded by BUSY_TIMEOUT_MS, so the event loop pause is
 * the same one `DatabaseSync` itself imposes while waiting on a lock.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function initializeConnection(db: DatabaseSync, migrations: MindosDatabaseMigration[]): void {
  // Pragmas run outside any transaction; journal_mode is persisted in the
  // file, the rest are per-connection.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const mode = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: unknown } | undefined;
  if (String(mode?.journal_mode ?? '').toLowerCase() !== 'wal') {
    // The switch was refused because another connection held the file; report
    // it as a busy condition so the open loop retries instead of running in
    // rollback-journal mode behind everyone else's back.
    const error = new Error('database is locked (journal_mode could not switch to WAL)');
    (error as { errcode?: number }).errcode = SQLITE_BUSY;
    throw error;
  }
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db, migrations);
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    closeAllMindosDatabases();
  });
}

function openImpl(resolved: string, migrations: MindosDatabaseMigration[]): MindosDatabaseImpl {
  const { DatabaseSync } = loadSqlite();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(resolved);
  } catch (error) {
    throw new Error(
      `MindOS could not open SQLite database ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  // Sibling processes (Web server + MCP server, or two CLI runs) may open a
  // brand-new file at the same instant. busy_timeout makes ordinary statements
  // wait, but SQLite does not run the busy handler while switching the journal
  // mode to WAL: that step either throws SQLITE_BUSY or quietly leaves the file
  // in rollback mode. Retry the whole initialization with a bounded backoff so
  // the loser of the race simply observes the winner's WAL file and schema.
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  let delayMs = 5;
  for (;;) {
    try {
      initializeConnection(db, migrations);
      break;
    } catch (error) {
      if (isBusyError(error) && Date.now() < deadline) {
        sleepSync(delayMs);
        delayMs = Math.min(delayMs * 2, 50);
        continue;
      }
      try { db.close(); } catch { /* best-effort cleanup */ }
      throw new Error(
        `MindOS could not initialize SQLite database ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  const handle = new MindosDatabaseImpl(resolved, db);
  openDatabases.set(resolved, handle);
  installExitHook();
  return handle;
}

/** Opens (creating and migrating if needed) the database at `options.file`. */
export function openMindosDatabase(options: OpenMindosDatabaseOptions): MindosDatabase {
  assertNodeRuntime();
  validateMigrations(options.migrations);
  const resolved = path.resolve(options.file);
  const cached = openDatabases.get(resolved);
  if (cached?.isOpen) return cached;
  return openImpl(resolved, options.migrations);
}

/**
 * Like `openMindosDatabase`, but returns null instead of creating the file
 * when it does not exist yet. Read paths use this so an empty store never
 * leaves a database (or its parent directory) behind.
 */
export function openMindosDatabaseIfExists(options: OpenMindosDatabaseOptions): MindosDatabase | null {
  assertNodeRuntime();
  validateMigrations(options.migrations);
  const resolved = path.resolve(options.file);
  const cached = openDatabases.get(resolved);
  if (cached?.isOpen) return cached;
  if (!fs.existsSync(resolved)) return null;
  return openImpl(resolved, options.migrations);
}

/** Closes the cached handle for `file` (or a memory database key), if any. */
export function closeMindosDatabase(file: string): void {
  (openDatabases.get(file) ?? openDatabases.get(path.resolve(file)))?.close();
}

/**
 * In-memory database cached under `key` for the process lifetime. Used as a
 * fallback when a store has no resolvable mind root, so callers keep working
 * in-process instead of losing state on a persistence failure.
 */
export function openMindosMemoryDatabase(key: string, migrations: MindosDatabaseMigration[]): MindosDatabase {
  validateMigrations(migrations);
  const cacheKey = `:memory:${key}`;
  const cached = openDatabases.get(cacheKey);
  if (cached?.isOpen) return cached;
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db, migrations);
  const handle = new MindosDatabaseImpl(cacheKey, db);
  openDatabases.set(cacheKey, handle);
  return handle;
}

/** Closes every cached handle (tests, process exit). */
export function closeAllMindosDatabases(): void {
  for (const handle of Array.from(openDatabases.values())) {
    handle.close();
  }
}

/** Escapes `%`, `_` and `\` so a user string can be embedded in `LIKE ? ESCAPE '\'`. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
