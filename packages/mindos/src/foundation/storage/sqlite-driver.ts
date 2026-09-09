/**
 * Runtime-selected SQLite driver for the MindOS derived-state stores
 * (spec-sqlite-bun-driver).
 *
 * `sqlite.ts` owns caching, WAL setup, migrations and transactions; this file
 * only answers "which embedded SQLite does this process have, and how do its
 * statements behave". Node processes (CLI on Node, Web server, Desktop) use
 * `node:sqlite`; the compiled platform binaries run under Bun and use
 * `bun:sqlite`. Callers must not be able to tell them apart, so the few
 * differences are normalised here:
 *
 * | behaviour                 | node:sqlite                  | bun:sqlite                         | here                 |
 * | run() counters            | number or bigint             | number                             | always number        |
 * | get() without a row       | undefined                    | null                               | undefined            |
 * | named parameters          | `$name` or bare `name`       | strict: bare only; else bare = NULL| strict + strip prefix|
 * | busy / locked errors      | errcode 5 / 6                | errno 5 / 6, code SQLITE_BUSY      | isBusyError()        |
 * | read-only missing file    | throws, no file              | needs readonly+create:false        | explicit flags       |
 *
 * Neither module is imported statically. vite (vitest) strips the `node:`
 * prefix and tries to resolve `sqlite` as an npm package, webpack would need
 * externals for both specifiers, and `bun:sqlite` does not exist on Node at
 * all. The specifiers are assembled at runtime and loaded through
 * `process.getBuiltinModule` (Node >= 22.3, Bun >= 1.1), falling back to
 * `createRequire`, so no bundler ever sees them.
 */

import { createRequire } from 'node:module';

export type SqliteValue = null | number | bigint | string | Uint8Array;
export type SqliteNamedParameters = Record<string, SqliteValue>;
export type SqliteParameter = SqliteValue | SqliteNamedParameters;
export type SqliteRow = Record<string, SqliteValue>;

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqliteStatement {
  all(...params: SqliteParameter[]): SqliteRow[];
  get(...params: SqliteParameter[]): SqliteRow | undefined;
  run(...params: SqliteParameter[]): SqliteRunResult;
}

export interface SqliteConnection {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export interface SqliteOpenOptions {
  /** Open without creating: a missing file throws instead of appearing on disk. */
  readOnly?: boolean;
}

export type SqliteDriverName = 'node:sqlite' | 'bun:sqlite';

export interface SqliteDriver {
  readonly name: SqliteDriverName;
  open(file: string, options?: SqliteOpenOptions): SqliteConnection;
}

/*
 * Minimal structural views of the two runtime modules. Declared locally rather
 * than pulled in as `import type` from the runtime modules or from @types/bun,
 * so that neither module specifier appears in this source at all (see the
 * contract test) and the Bun side needs no extra type package.
 */
interface RawStatement {
  all(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface RawDatabase {
  prepare(sql: string): RawStatement;
  exec(sql: string): unknown;
  close(): void;
}

export interface NodeSqliteModule {
  DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => RawDatabase;
}

export interface BunSqliteModule {
  Database: new (
    file: string,
    options?: { readonly?: boolean; readwrite?: boolean; create?: boolean; strict?: boolean },
  ) => RawDatabase;
}

/** Injection points for tests; production uses `defaultLoaders`. */
export interface SqliteDriverLoaders {
  isBun: () => boolean;
  loadBunModule: () => BunSqliteModule | undefined;
  loadNodeModule: () => NodeSqliteModule | undefined;
  /** Shown in "driver not available" errors. */
  runtimeVersion: string;
}

const NODE_SQLITE_SPECIFIER = ['node', 'sqlite'].join(':');
const BUN_SQLITE_SPECIFIER = ['bun', 'sqlite'].join(':');

export const SQLITE_BUSY = 5;
export const SQLITE_LOCKED = 6;

function loadRuntimeModule(specifier: string): unknown {
  if (typeof process.getBuiltinModule === 'function') {
    try {
      const loaded = process.getBuiltinModule(specifier as never) as unknown;
      if (loaded) return loaded;
    } catch {
      // Older runtimes throw for unknown ids; try the require path below.
    }
  }
  try {
    return createRequire(import.meta.url)(specifier) as unknown;
  } catch {
    return undefined;
  }
}

const defaultLoaders: SqliteDriverLoaders = {
  isBun: () => typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined',
  loadBunModule: () => loadRuntimeModule(BUN_SQLITE_SPECIFIER) as BunSqliteModule | undefined,
  loadNodeModule: () => loadRuntimeModule(NODE_SQLITE_SPECIFIER) as NodeSqliteModule | undefined,
  runtimeVersion: process.versions.bun ? `Bun ${process.versions.bun}` : process.version,
};

/**
 * Picks the driver for the current runtime. Under Bun only `bun:sqlite` is
 * acceptable: `node:sqlite` is not implemented there, and silently falling back
 * would hide a broken binary until the first ledger write.
 */
export function createSqliteDriver(loaders: SqliteDriverLoaders = defaultLoaders): SqliteDriver {
  if (loaders.isBun()) {
    const bunModule = loaders.loadBunModule();
    if (!bunModule || typeof bunModule.Database !== 'function') {
      throw new Error(
        `bun:sqlite is not available in this Bun runtime (${loaders.runtimeVersion}); `
        + 'MindOS SQLite stores need a Bun build that ships bun:sqlite.',
      );
    }
    return createBunDriver(bunModule);
  }
  const nodeModule = loaders.loadNodeModule();
  if (!nodeModule || typeof nodeModule.DatabaseSync !== 'function') {
    throw new Error(
      `node:sqlite is not available in this runtime (Node >= 22.19 required, got ${loaders.runtimeVersion}).`,
    );
  }
  return createNodeDriver(nodeModule);
}

let activeDriver: SqliteDriver | null = null;

/** The process-wide driver, created on first use. */
export function loadSqliteDriver(): SqliteDriver {
  if (!activeDriver) activeDriver = createSqliteDriver();
  return activeDriver;
}

/** Name of the driver this process uses (`node:sqlite` or `bun:sqlite`). */
export function sqliteDriverName(): SqliteDriverName {
  return loadSqliteDriver().name;
}

function createNodeDriver(nodeModule: NodeSqliteModule): SqliteDriver {
  return {
    name: 'node:sqlite',
    open(file, options = {}) {
      // node:sqlite rejects an explicit `undefined` options argument, so the
      // read-write path passes nothing at all.
      const db = options.readOnly
        ? new nodeModule.DatabaseSync(file, { readOnly: true })
        : new nodeModule.DatabaseSync(file);
      return wrapConnection(db, (params) => params);
    },
  };
}

function createBunDriver(bunModule: BunSqliteModule): SqliteDriver {
  return {
    name: 'bun:sqlite',
    open(file, options = {}) {
      const readOnly = options.readOnly === true;
      // All three flags are explicit: `create: false` on its own leaves Bun
      // with an empty flag set (SQLITE_MISUSE), and only readonly + no create
      // reports a missing file (SQLITE_CANTOPEN) instead of creating it.
      // `strict` makes missing named parameters throw; without it Bun binds
      // bare `{ name }` keys to NULL silently.
      const db = new bunModule.Database(file, {
        readonly: readOnly,
        readwrite: !readOnly,
        create: !readOnly,
        strict: true,
      });
      return wrapConnection(db, stripNamedParameterPrefixes);
    },
  };
}

function wrapConnection(
  db: RawDatabase,
  normalizeParameters: (params: SqliteParameter[]) => SqliteParameter[],
): SqliteConnection {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all: (...params) => statement.all(...normalizeParameters(params)) as SqliteRow[],
        get: (...params) => (statement.get(...normalizeParameters(params)) ?? undefined) as SqliteRow | undefined,
        run: (...params) => normalizeRunResult(statement.run(...normalizeParameters(params))),
      };
    },
    exec(sql) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}

function toCount(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

/**
 * `{ changes, lastInsertRowid }` as plain numbers. node:sqlite may hand back
 * bigint when `readBigInts` is on; MindOS row ids stay far below 2^53.
 */
export function normalizeRunResult(raw: unknown): SqliteRunResult {
  const source = (raw ?? {}) as { changes?: unknown; lastInsertRowid?: unknown };
  return { changes: toCount(source.changes), lastInsertRowid: toCount(source.lastInsertRowid) };
}

function isNamedParameters(param: SqliteParameter): param is SqliteNamedParameters {
  return typeof param === 'object' && param !== null && !ArrayBuffer.isView(param);
}

/**
 * Bun's strict mode wants `{ name }` for `$name`, `:name` and `@name` alike,
 * while node:sqlite callers may write `{ $name }`. Strip one leading prefix so
 * both spellings bind the same parameter under both drivers.
 */
export function stripNamedParameterPrefixes(params: SqliteParameter[]): SqliteParameter[] {
  return params.map((param) => {
    if (!isNamedParameters(param)) return param;
    const stripped: SqliteNamedParameters = {};
    for (const [key, value] of Object.entries(param)) {
      stripped[/^[$:@]/.test(key) ? key.slice(1) : key] = value;
    }
    return stripped;
  });
}

function isBusyCode(value: unknown): boolean {
  return value === SQLITE_BUSY || value === SQLITE_LOCKED;
}

/**
 * True for SQLITE_BUSY / SQLITE_LOCKED from either driver: node:sqlite sets
 * `errcode`, bun:sqlite's SQLiteError sets `errno` and a `code` string, and a
 * synthetic error may only carry the message.
 */
export function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { errcode, errno, code } = error as { errcode?: unknown; errno?: unknown; code?: unknown };
  if (isBusyCode(errcode) || isBusyCode(errno)) return true;
  if (typeof code === 'string' && /^SQLITE_(BUSY|LOCKED)/.test(code)) return true;
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(error.message);
}
