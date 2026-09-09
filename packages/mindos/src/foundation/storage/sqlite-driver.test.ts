import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteDriver,
  isBusyError,
  normalizeRunResult,
  stripNamedParameterPrefixes,
  type BunSqliteModule,
  type NodeSqliteModule,
  type SqliteDriverLoaders,
} from './sqlite-driver.js';

/**
 * Driver-level behaviour: the pieces that differ between `node:sqlite` and
 * `bun:sqlite` and must be normalised before `sqlite.ts` sees them. The Bun
 * driver is exercised against a recording fake here (vitest runs on Node);
 * the real `bun:sqlite` behaviour is covered by the Bun runtime tests in
 * `sqlite.test.ts`, which spawn `bun` against the built dist/.
 */

const nodeModule = process.getBuiltinModule('node:sqlite') as unknown as NodeSqliteModule;

const nodeLoaders: SqliteDriverLoaders = {
  isBun: () => false,
  loadBunModule: () => undefined,
  loadNodeModule: () => nodeModule,
  runtimeVersion: 'v99.0.0-test',
};

let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-sqlite-driver-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('isBusyError', () => {
  it('recognises node:sqlite errcode 5 and 6', () => {
    expect(isBusyError(Object.assign(new Error('x'), { errcode: 5 }))).toBe(true);
    expect(isBusyError(Object.assign(new Error('x'), { errcode: 6 }))).toBe(true);
  });

  it('recognises bun:sqlite errno / code pairs', () => {
    expect(isBusyError(Object.assign(new Error('x'), { errno: 5, code: 'SQLITE_BUSY' }))).toBe(true);
    expect(isBusyError(Object.assign(new Error('x'), { errno: 6, code: 'SQLITE_LOCKED' }))).toBe(true);
    expect(isBusyError(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe(true);
    expect(isBusyError(Object.assign(new Error('x'), { errno: 6 }))).toBe(true);
  });

  it('falls back to the message when no code is attached', () => {
    expect(isBusyError(new Error('database is locked'))).toBe(true);
    expect(isBusyError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isBusyError(undefined)).toBe(false);
    expect(isBusyError(null)).toBe(false);
    expect(isBusyError('database is locked')).toBe(false);
    expect(isBusyError(new Error('no such table: items'))).toBe(false);
    expect(isBusyError(Object.assign(new Error('unable to open database file'), { errcode: 14 }))).toBe(false);
    expect(isBusyError(Object.assign(new Error('unable to open database file'), { errno: 14, code: 'SQLITE_CANTOPEN' }))).toBe(false);
  });
});

describe('normalizeRunResult', () => {
  it('converts bigint counters from node:sqlite to numbers', () => {
    expect(normalizeRunResult({ changes: 1n, lastInsertRowid: 42n })).toEqual({ changes: 1, lastInsertRowid: 42 });
  });

  it('passes numeric counters through unchanged', () => {
    expect(normalizeRunResult({ changes: 3, lastInsertRowid: 7 })).toEqual({ changes: 3, lastInsertRowid: 7 });
  });

  it('defaults missing or unusable fields to 0', () => {
    expect(normalizeRunResult({})).toEqual({ changes: 0, lastInsertRowid: 0 });
    expect(normalizeRunResult(undefined)).toEqual({ changes: 0, lastInsertRowid: 0 });
    expect(normalizeRunResult({ changes: 'x', lastInsertRowid: NaN })).toEqual({ changes: 0, lastInsertRowid: 0 });
  });
});

describe('stripNamedParameterPrefixes', () => {
  it('removes $, : and @ prefixes from named parameter objects', () => {
    expect(stripNamedParameterPrefixes([{ $a: 1, ':b': 'two', '@c': null, d: 4 }])).toEqual([{ a: 1, b: 'two', c: null, d: 4 }]);
  });

  it('leaves positional parameters untouched, including binary values', () => {
    const blob = new Uint8Array([1, 2, 3]);
    const params = ['x', 1, null, 2n, blob];
    expect(stripNamedParameterPrefixes(params)).toEqual(params);
    expect(stripNamedParameterPrefixes(params)[4]).toBe(blob);
  });

  it('handles a mix of named and positional parameters and empty objects', () => {
    expect(stripNamedParameterPrefixes([{ $a: 1 }, 'x', {}])).toEqual([{ a: 1 }, 'x', {}]);
    expect(stripNamedParameterPrefixes([])).toEqual([]);
  });

  it('only strips a single leading prefix character', () => {
    expect(stripNamedParameterPrefixes([{ $$weird: 1, '$': 2 }])).toEqual([{ $weird: 1, '': 2 }]);
  });
});

describe('createSqliteDriver (node:sqlite)', () => {
  it('opens a real database, normalises run results and returns undefined for a missing row', () => {
    const driver = createSqliteDriver(nodeLoaders);
    expect(driver.name).toBe('node:sqlite');
    const file = path.join(dir, 'node.sqlite');
    const conn = driver.open(file);
    conn.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, label TEXT)');
    const insert = conn.prepare('INSERT INTO t(label) VALUES (?)');
    const result = insert.run('a');
    expect(result).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(typeof result.lastInsertRowid).toBe('number');
    expect(conn.prepare('INSERT INTO t(label) VALUES ($label)').run({ $label: 'b' })).toEqual({ changes: 1, lastInsertRowid: 2 });
    expect(conn.prepare('SELECT label FROM t ORDER BY id').all()).toEqual([{ label: 'a' }, { label: 'b' }]);
    expect(conn.prepare('SELECT label FROM t WHERE id = ?').get(999)).toBeUndefined();
    expect(conn.prepare('PRAGMA journal_mode = WAL').get()).toEqual({ journal_mode: 'wal' });
    conn.close();
  });

  it('does not create a file when opening a missing database read-only', () => {
    const driver = createSqliteDriver(nodeLoaders);
    const file = path.join(dir, 'missing', 'ro.sqlite');
    expect(() => driver.open(file, { readOnly: true })).toThrow();
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  it('reports a clear error when node:sqlite is unavailable', () => {
    expect(() => createSqliteDriver({ ...nodeLoaders, loadNodeModule: () => undefined }))
      .toThrow(/node:sqlite is not available.*v99\.0\.0-test/);
    expect(() => createSqliteDriver({ ...nodeLoaders, loadNodeModule: () => ({}) as NodeSqliteModule }))
      .toThrow(/node:sqlite is not available/);
  });
});

interface FakeBunCall {
  method: 'all' | 'get' | 'run';
  params: unknown[];
}

function createFakeBunModule(options: { getReturns?: unknown } = {}) {
  const constructed: Array<{ file: string; options: Record<string, unknown> | undefined }> = [];
  const calls: FakeBunCall[] = [];
  const execs: string[] = [];
  let closed = 0;
  class FakeStatement {
    all(...params: unknown[]): unknown[] {
      calls.push({ method: 'all', params });
      return [{ label: 'row' }];
    }
    get(...params: unknown[]): unknown {
      calls.push({ method: 'get', params });
      return options.getReturns ?? null;
    }
    run(...params: unknown[]): unknown {
      calls.push({ method: 'run', params });
      return { changes: 1, lastInsertRowid: 9 };
    }
  }
  class FakeDatabase {
    constructor(file: string, opts?: Record<string, unknown>) {
      constructed.push({ file, options: opts });
    }
    prepare(): FakeStatement { return new FakeStatement(); }
    exec(sql: string): void { execs.push(sql); }
    close(): void { closed += 1; }
  }
  const module = { Database: FakeDatabase } as unknown as BunSqliteModule;
  return { module, constructed, calls, execs, closedCount: () => closed };
}

describe('createSqliteDriver (bun:sqlite)', () => {
  it('is selected when the Bun global is present and opens in strict mode with explicit flags', () => {
    const fake = createFakeBunModule();
    const driver = createSqliteDriver({ ...nodeLoaders, isBun: () => true, loadBunModule: () => fake.module });
    expect(driver.name).toBe('bun:sqlite');
    driver.open('/tmp/x.sqlite');
    driver.open('/tmp/y.sqlite', { readOnly: true });
    expect(fake.constructed).toEqual([
      { file: '/tmp/x.sqlite', options: { readonly: false, readwrite: true, create: true, strict: true } },
      { file: '/tmp/y.sqlite', options: { readonly: true, readwrite: false, create: false, strict: true } },
    ]);
  });

  it('strips named parameter prefixes, normalises get() null and run() results', () => {
    const fake = createFakeBunModule();
    const driver = createSqliteDriver({ ...nodeLoaders, isBun: () => true, loadBunModule: () => fake.module });
    const conn = driver.open('/tmp/x.sqlite');
    const statement = conn.prepare('INSERT INTO t(label) VALUES ($label)');
    expect(statement.run({ $label: 'a' })).toEqual({ changes: 1, lastInsertRowid: 9 });
    expect(statement.get(1, { ':b': 2 })).toBeUndefined();
    expect(statement.all('x')).toEqual([{ label: 'row' }]);
    expect(fake.calls).toEqual([
      { method: 'run', params: [{ label: 'a' }] },
      { method: 'get', params: [1, { b: 2 }] },
      { method: 'all', params: ['x'] },
    ]);
    conn.exec('PRAGMA busy_timeout = 1');
    conn.close();
    expect(fake.execs).toEqual(['PRAGMA busy_timeout = 1']);
    expect(fake.closedCount()).toBe(1);
  });

  it('passes a real row through get() unchanged', () => {
    const fake = createFakeBunModule({ getReturns: { n: 3 } });
    const driver = createSqliteDriver({ ...nodeLoaders, isBun: () => true, loadBunModule: () => fake.module });
    expect(driver.open('/tmp/x.sqlite').prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 3 });
  });

  it('never falls back to node:sqlite under Bun and names the runtime in the error', () => {
    expect(() => createSqliteDriver({
      ...nodeLoaders,
      isBun: () => true,
      loadBunModule: () => undefined,
      runtimeVersion: 'bun 1.0.0-test',
    })).toThrow(/bun:sqlite is not available.*bun 1\.0\.0-test/);
  });
});
