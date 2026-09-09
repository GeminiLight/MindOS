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
const suitePath = path.join(here, 'sqlite-runtime-suite-driver.mjs');

/**
 * Absolute path of `bun` on PATH, or null. The Bun runtime tests below run the
 * same driver scripts under Bun to prove the `bun:sqlite` driver behaves like
 * the Node one; without Bun they are skipped with a logged reason rather than
 * silently passing.
 */
function findBun(): string | null {
  if (process.env.MINDOS_TEST_SKIP_BUN === '1') return null;
  const names = process.platform === 'win32' ? ['bun.exe', 'bun.cmd', 'bun'] : ['bun'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

const bun = findBun();
if (!bun) {
  console.warn('[sqlite.test] `bun` not found on PATH; skipping Bun runtime tests (install Bun to exercise the bun:sqlite driver).');
}

const MIGRATIONS: MindosDatabaseMigration[] = [
  { version: 1, sql: 'CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT NOT NULL);' },
  { version: 2, sql: 'CREATE INDEX idx_items_label ON items(label);' },
];

let dir = '';
let file = '';

function ensureFreshDist(): void {
  const probe = path.join(distDir, 'foundation', 'storage', 'sqlite.js');
  const sourceMtime = Math.max(
    ...['sqlite.ts', 'sqlite-driver.ts'].map((name) => fs.statSync(path.join(here, name)).mtimeMs),
  );
  const distMtime = fs.existsSync(probe) ? fs.statSync(probe).mtimeMs : -1;
  if (distMtime < sourceMtime) {
    execFileSync(path.join(pkgRoot, 'node_modules', '.bin', 'tsc'), [], { cwd: pkgRoot, stdio: 'ignore' });
  }
}

function runScript(execPath: string, scriptPath: string, args: string[]): Promise<Record<string, unknown>> {
  const label = `${path.basename(execPath)} ${path.basename(scriptPath)} ${args.slice(2).join(' ')}`.trim();
  return new Promise((resolve, reject) => {
    const child = spawn(execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error(`${label} produced unparsable output: ${stdout}`));
      }
    });
  });
}

function runDriver(mode: string, ...args: string[]): Promise<Record<string, unknown>> {
  return runScript(process.execPath, driverPath, [distDir, file, mode, ...args]);
}

function runBunDriver(mode: string, ...args: string[]): Promise<Record<string, unknown>> {
  return runScript(bun as string, driverPath, [distDir, file, mode, ...args]);
}

function runSuite(execPath: string, dbFile: string): Promise<Record<string, unknown>> {
  return runScript(execPath, suitePath, [distDir, dbFile]);
}

/** Everything the runtime suite must report identically under Node and Bun. */
function expectedSuiteReport(runtime: 'node' | 'bun', driver: 'node:sqlite' | 'bun:sqlite'): Record<string, unknown> {
  return {
    runtime,
    driver,
    driverName: driver,
    readOnlyMissing: { result: null, fileExists: false, dirExists: false },
    fileExists: true,
    journal: 'wal',
    synchronous: 1,
    busyTimeout: 5000,
    foreignKeys: 1,
    migrations: [1, 2],
    firstRun: { changes: 1, lastInsertRowid: 1 },
    lastInsertRowidType: 'number',
    namedDollar: { changes: 1, lastInsertRowid: 2 },
    namedBare: { changes: 1, lastInsertRowid: 3 },
    namedColon: { changes: 1, lastInsertRowid: 4 },
    labels: ['positional', 'dollar', 'bare', 'colon'],
    getMissingIsUndefined: true,
    getRow: { id: 2, label: 'dollar' },
    countRow: { n: 4 },
    rollbackError: 'boom',
    afterRollback: 4,
    transactionResult: 'committed',
    afterCommit: 6,
    notNullViolation: true,
    busyErrorOnPlainError: false,
    cachedHandleSame: true,
    existsHandleSame: true,
    memoryCount: 1,
    memoryDriver: driver,
    isOpenAfterClose: false,
    closedError: 'MindOS SQLite database is closed: <file>',
    lease: {
      stateFileExists: true,
      acquired: true,
      acquiredForMs: 1000,
      blockedBy: 'first',
      renewedUntilOffsetMs: 2600,
      stillBlockedBy: 'first',
      takenOverBy: 'second',
      staleOwnerRelease: false,
      ownerRelease: true,
      afterRelease: null,
    },
    reopenedIsNewHandle: true,
    reopenedCount: 6,
    reopenedMigrations: 2,
    reopenedClosedByCloseAll: true,
  };
}

/** Polls until the lease holder child has published its marker file. */
async function waitForLeaseHolder(mindRoot: string): Promise<void> {
  const marker = path.join(mindRoot, 'lease-held');
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(marker)) {
    if (Date.now() > deadline) throw new Error('lease holder never published its marker');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Drops the fields that legitimately differ between runtimes. */
function runtimeNeutral(report: Record<string, unknown>): Record<string, unknown> {
  const { pid: _pid, runtime: _runtime, driver: _driver, driverName: _driverName, memoryDriver: _memoryDriver, ...rest } = report;
  return rest;
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

  it('runtime suite under node reports the node:sqlite driver with normalised results', async () => {
    const report = await runSuite(process.execPath, file);
    expect(report).toEqual({ pid: expect.any(Number), ...expectedSuiteReport('node', 'node:sqlite') });
  }, 60_000);

  describe.skipIf(!bun)('Bun runtime (bun:sqlite driver)', () => {
    it('runtime suite under bun reports bun:sqlite and matches the node report field for field', async () => {
      const nodeFile = path.join(dir, 'node', 'store_1.sqlite');
      const bunFile = path.join(dir, 'bun', 'store_1.sqlite');
      const [nodeReport, bunReport] = await Promise.all([
        runSuite(process.execPath, nodeFile),
        runSuite(bun as string, bunFile),
      ]);
      expect(bunReport).toEqual({ pid: expect.any(Number), ...expectedSuiteReport('bun', 'bun:sqlite') });
      expect(runtimeNeutral(bunReport)).toEqual(runtimeNeutral(nodeReport));
    }, 60_000);

    it('two bun processes writing concurrently lose no rows and apply migrations exactly once', async () => {
      const COUNT = 400;
      const [a, b] = await Promise.all([
        runBunDriver('insert-many', 'bun-a', String(COUNT)),
        runBunDriver('insert-many', 'bun-b', String(COUNT)),
      ]);
      expect(a.pid).not.toBe(b.pid);
      expect([a.runtime, b.runtime]).toEqual(['bun', 'bun']);
      expect([a.driver, b.driver]).toEqual(['bun:sqlite', 'bun:sqlite']);

      const db = openMindosDatabase({ file, migrations: MIGRATIONS });
      expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: COUNT * 2 });
      expect(db.prepare("SELECT count(*) AS n FROM items WHERE label LIKE 'bun-a-%'").get()).toEqual({ n: COUNT });
      expect(db.prepare("SELECT count(*) AS n FROM items WHERE label LIKE 'bun-b-%'").get()).toEqual({ n: COUNT });
      expect(db.prepare('SELECT count(*) AS n FROM _migrations').get()).toEqual({ n: 2 });
    }, 60_000);

    it('a bun writer and a node writer share one WAL file concurrently without losing rows', async () => {
      const COUNT = 300;
      const [viaBun, viaNode] = await Promise.all([
        runBunDriver('insert-many', 'bun', String(COUNT)),
        runDriver('insert-many', 'node', String(COUNT)),
      ]);
      expect(viaBun.driver).toBe('bun:sqlite');
      expect(viaNode.driver).toBe('node:sqlite');

      const db = openMindosDatabase({ file, migrations: MIGRATIONS });
      expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: COUNT * 2 });
      expect(db.prepare("SELECT count(*) AS n FROM items WHERE label LIKE 'bun-%'").get()).toEqual({ n: COUNT });
      expect(db.prepare("SELECT count(*) AS n FROM items WHERE label LIKE 'node-%'").get()).toEqual({ n: COUNT });
      expect(db.prepare('SELECT count(*) AS n FROM _migrations').get()).toEqual({ n: 2 });
    }, 60_000);

    it('several bun processes initialising the same fresh database concurrently all succeed', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => runBunDriver('open-only')));
      expect(new Set(results.map((r) => r.pid)).size).toBe(6);
      for (const result of results) {
        expect(result).toMatchObject({ runtime: 'bun', driver: 'bun:sqlite', journal: 'wal', migrations: 2 });
      }
      const db = openMindosDatabase({ file, migrations: MIGRATIONS });
      expect(db.prepare('SELECT count(*) AS n FROM _migrations').get()).toEqual({ n: 2 });
    }, 60_000);

    it('a bun process waits for a writer holding the lock instead of failing immediately (busy timeout)', async () => {
      openMindosDatabase({ file, migrations: MIGRATIONS });
      closeMindosDatabase(file);
      const holdMs = 800;
      const holder = runBunDriver('hold-write-lock', String(holdMs));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const writer = await runBunDriver('insert-many', 'bun-waiter', '1');
      const held = await holder;
      expect(held.held).toBe(true);
      expect(writer.elapsedMs as number).toBeGreaterThan(100);
      expect(writer.elapsedMs as number).toBeLessThan(5000);

      const db = openMindosDatabase({ file, migrations: MIGRATIONS });
      expect(db.prepare('SELECT label FROM items ORDER BY id').all()).toEqual([
        { label: 'holder-row' },
        { label: 'bun-waiter-0' },
      ]);
    }, 30_000);

    it('a lease held by a bun process blocks a node acquirer on the shared state database until release', async () => {
      // leases.ts (spec-automations-lease-store) is built only on the public
      // store API; the two drivers must agree on BEGIN IMMEDIATE + changes().
      const holder = runScript(bun as string, driverPath, [distDir, dir, 'hold-lease', '600', 'bun-holder']);
      await waitForLeaseHolder(dir);
      const acquirer = await runScript(process.execPath, driverPath, [distDir, dir, 'acquire-lease', 'node-acquirer', '5000']);
      const held = await holder;
      expect(held).toMatchObject({ runtime: 'bun', owner: 'bun-holder', released: true });
      expect(acquirer).toMatchObject({ runtime: 'node', owner: 'node-acquirer', released: true });
      expect(acquirer.elapsedMs as number).toBeGreaterThan(100);
      expect(acquirer.elapsedMs as number).toBeLessThan(5000);
      expect(fs.existsSync(path.join(dir, '.mindos', 'db', 'state_1.sqlite'))).toBe(true);
    }, 30_000);
  });
});
