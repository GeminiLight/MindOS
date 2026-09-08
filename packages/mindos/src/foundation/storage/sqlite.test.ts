import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeAllMindosDatabases,
  closeMindosDatabase,
  openMindosDatabase,
  openMindosDatabaseIfExists,
  type MindosDatabaseMigration,
} from './sqlite.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..', '..');
const distDir = path.join(pkgRoot, 'dist');
const driverPath = path.join(here, 'sqlite-two-process-driver.mjs');

const MIGRATIONS: MindosDatabaseMigration[] = [
  { version: 1, sql: 'CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT NOT NULL);' },
  { version: 2, sql: 'CREATE INDEX idx_items_label ON items(label);' },
];

let dir = '';
let file = '';

function ensureFreshDist(): void {
  const probe = path.join(distDir, 'foundation', 'storage', 'sqlite.js');
  const source = path.join(here, 'sqlite.ts');
  const distMtime = fs.existsSync(probe) ? fs.statSync(probe).mtimeMs : -1;
  if (distMtime < fs.statSync(source).mtimeMs) {
    execFileSync(path.join(pkgRoot, 'node_modules', '.bin', 'tsc'), [], { cwd: pkgRoot, stdio: 'ignore' });
  }
}

function runDriver(mode: string, ...args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driverPath, distDir, file, mode, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`driver ${mode} exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error(`driver ${mode} produced unparsable output: ${stdout}`));
      }
    });
  });
}

describe('foundation/storage/sqlite', () => {
  beforeAll(() => {
    ensureFreshDist();
  }, 120_000);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-sqlite-'));
    file = path.join(dir, 'nested', 'store_1.sqlite');
  });

  afterEach(() => {
    closeAllMindosDatabases();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens in WAL mode with the expected pragmas and creates parent directories', () => {
    const db = openMindosDatabase({ file, migrations: MIGRATIONS });
    expect(fs.existsSync(file)).toBe(true);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 });
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('applies migrations once, records them, and is idempotent across reopen', () => {
    const first = openMindosDatabase({ file, migrations: MIGRATIONS });
    expect(first.prepare('SELECT version FROM _migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }]);
    first.prepare('INSERT INTO items(label) VALUES (?)').run('a');
    closeMindosDatabase(file);

    const second = openMindosDatabase({ file, migrations: MIGRATIONS });
    expect(second.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 1 });
    expect(second.prepare('SELECT count(*) AS n FROM _migrations').get()).toEqual({ n: 2 });

    // A newer migration list only applies the versions not yet recorded.
    closeMindosDatabase(file);
    const third = openMindosDatabase({
      file,
      migrations: [...MIGRATIONS, { version: 3, sql: 'ALTER TABLE items ADD COLUMN note TEXT;' }],
    });
    expect(third.prepare('SELECT version FROM _migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    third.prepare('INSERT INTO items(label, note) VALUES (?, ?)').run('b', 'ok');
  });

  it('rejects unsorted or duplicate migration versions before touching the file', () => {
    expect(() => openMindosDatabase({ file, migrations: [{ version: 2, sql: 'SELECT 1;' }, { version: 1, sql: 'SELECT 1;' }] }))
      .toThrow(/ascending/i);
    expect(() => openMindosDatabase({ file, migrations: [{ version: 1, sql: 'SELECT 1;' }, { version: 1, sql: 'SELECT 1;' }] }))
      .toThrow(/ascending/i);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('returns the same cached handle for the same resolved path and a fresh one after close', () => {
    const a = openMindosDatabase({ file, migrations: MIGRATIONS });
    const b = openMindosDatabase({ file: path.join(dir, 'nested', '..', 'nested', 'store_1.sqlite'), migrations: MIGRATIONS });
    expect(b).toBe(a);
    closeMindosDatabase(file);
    expect(a.isOpen).toBe(false);
    const c = openMindosDatabase({ file, migrations: MIGRATIONS });
    expect(c).not.toBe(a);
    expect(c.isOpen).toBe(true);
  });

  it('rolls back a transaction when the callback throws and commits otherwise', () => {
    const db = openMindosDatabase({ file, migrations: MIGRATIONS });
    const insert = db.prepare('INSERT INTO items(label) VALUES (?)');
    expect(() => db.transaction(() => {
      insert.run('kept?');
      throw new Error('boom');
    })).toThrow('boom');
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 0 });

    const result = db.transaction(() => {
      insert.run('x');
      insert.run('y');
      return 'done';
    });
    expect(result).toBe('done');
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 2 });

    // Nested transaction calls join the outer one instead of failing.
    db.transaction(() => {
      insert.run('outer');
      db.transaction(() => insert.run('inner'));
    });
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 4 });
  });

  it('does not create a file for read-only opens of a missing database', () => {
    expect(openMindosDatabaseIfExists({ file, migrations: MIGRATIONS })).toBeNull();
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    openMindosDatabase({ file, migrations: MIGRATIONS });
    closeMindosDatabase(file);
    expect(openMindosDatabaseIfExists({ file, migrations: MIGRATIONS })).not.toBeNull();
  });

  it('two real processes writing concurrently lose no rows and apply migrations exactly once', async () => {
    const COUNT = 400;
    const [a, b] = await Promise.all([
      runDriver('insert-many', 'proc-a', String(COUNT)),
      runDriver('insert-many', 'proc-b', String(COUNT)),
    ]);
    expect(a.pid).not.toBe(b.pid);

    const db = openMindosDatabase({ file, migrations: MIGRATIONS });
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: COUNT * 2 });
    expect(db.prepare("SELECT count(*) AS n FROM items WHERE label LIKE 'proc-a-%'").get()).toEqual({ n: COUNT });
    expect(db.prepare("SELECT count(*) AS n FROM items WHERE label LIKE 'proc-b-%'").get()).toEqual({ n: COUNT });
    expect(db.prepare('SELECT count(*) AS n FROM _migrations').get()).toEqual({ n: 2 });
  }, 60_000);

  it('several real processes initialising the same fresh database concurrently all succeed', async () => {
    // Regression: switching a brand-new file into WAL needs an exclusive lock
    // and SQLite does not run the busy handler for that step, so siblings that
    // open at the same instant used to die with "database is locked".
    const results = await Promise.all(Array.from({ length: 6 }, () => runDriver('open-only')));
    expect(new Set(results.map((r) => r.pid)).size).toBe(6);
    for (const result of results) {
      expect(result.journal).toBe('wal');
      expect(result.migrations).toBe(2);
    }
    const db = openMindosDatabase({ file, migrations: MIGRATIONS });
    expect(db.prepare('SELECT count(*) AS n FROM _migrations').get()).toEqual({ n: 2 });
  }, 60_000);

  it('waits for a writer holding the lock instead of failing immediately (busy timeout)', async () => {
    openMindosDatabase({ file, migrations: MIGRATIONS });
    closeMindosDatabase(file);
    const holdMs = 800;
    const holder = runDriver('hold-write-lock', String(holdMs));
    // Give the child time to acquire its write transaction.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const started = Date.now();
    const db = openMindosDatabase({ file, migrations: MIGRATIONS });
    db.prepare('INSERT INTO items(label) VALUES (?)').run('parent-after-wait');
    const waited = Date.now() - started;
    const result = await holder;
    expect(result.held).toBe(true);
    expect(waited).toBeGreaterThan(100);
    expect(waited).toBeLessThan(5000);
    expect(db.prepare('SELECT label FROM items ORDER BY id').all()).toEqual([
      { label: 'holder-row' },
      { label: 'parent-after-wait' },
    ]);
  }, 30_000);
});
