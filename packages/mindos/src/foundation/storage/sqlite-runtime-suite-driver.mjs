// Runtime suite driver for sqlite.test.ts. Runs the single-process behaviour
// of the store (open, WAL pragmas, migrations, inserts, named parameters,
// transaction rollback, read-only-missing, handle cache, close) against the
// built dist/ output and prints one JSON report. The test runs it under both
// `node` and `bun`; apart from pid / runtime / driver the two reports must be
// identical, which is what "one behaviour for callers" means in practice.
// Not compiled by tsc (plain .mjs) and not collected by vitest (not *.test.ts).
//
// argv: <distDir> <dbFile>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distDir, dbFile] = process.argv.slice(2);
const sqlite = await import(pathToFileURL(path.join(distDir, 'foundation/storage/sqlite.js')).href);
const leases = await import(pathToFileURL(path.join(distDir, 'foundation/storage/leases.js')).href);

const migrations = [
  { version: 1, sql: 'CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT NOT NULL);' },
  { version: 2, sql: 'CREATE INDEX idx_items_label ON items(label);' },
];

const report = {
  pid: process.pid,
  runtime: typeof Bun !== 'undefined' ? 'bun' : 'node',
};

// Read paths must not leave a database (or its directory) behind.
report.readOnlyMissing = {
  result: sqlite.openMindosDatabaseIfExists({ file: dbFile, migrations }),
  fileExists: fs.existsSync(dbFile),
  dirExists: fs.existsSync(path.dirname(dbFile)),
};

const db = sqlite.openMindosDatabase({ file: dbFile, migrations });
report.driver = db.driver;
report.driverName = sqlite.sqliteDriverName();
report.fileExists = fs.existsSync(dbFile);
report.journal = db.prepare('PRAGMA journal_mode').get().journal_mode;
report.synchronous = db.prepare('PRAGMA synchronous').get().synchronous;
report.busyTimeout = db.prepare('PRAGMA busy_timeout').get().timeout;
report.foreignKeys = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
report.migrations = db.prepare('SELECT version FROM _migrations ORDER BY version').all().map((row) => row.version);

const insert = db.prepare('INSERT INTO items(label) VALUES (?)');
report.firstRun = insert.run('positional');
report.lastInsertRowidType = typeof report.firstRun.lastInsertRowid;
report.namedDollar = db.prepare('INSERT INTO items(label) VALUES ($label)').run({ $label: 'dollar' });
report.namedBare = db.prepare('INSERT INTO items(label) VALUES ($label)').run({ label: 'bare' });
report.namedColon = db.prepare('INSERT INTO items(label) VALUES (:label)').run({ label: 'colon' });
report.labels = db.prepare('SELECT label FROM items ORDER BY id').all().map((row) => row.label);
report.getMissingIsUndefined = db.prepare('SELECT * FROM items WHERE id = ?').get(999) === undefined;
report.getRow = db.prepare('SELECT id, label FROM items WHERE label = ?').get('dollar');
report.countRow = db.prepare('SELECT count(*) AS n FROM items').get();

try {
  db.transaction(() => {
    insert.run('doomed');
    throw new Error('boom');
  });
  report.rollbackError = null;
} catch (error) {
  report.rollbackError = error instanceof Error ? error.message : String(error);
}
report.afterRollback = db.prepare('SELECT count(*) AS n FROM items').get().n;
report.transactionResult = db.transaction(() => {
  insert.run('outer');
  db.transaction(() => insert.run('inner'));
  return 'committed';
});
report.afterCommit = db.prepare('SELECT count(*) AS n FROM items').get().n;

try {
  db.prepare('INSERT INTO items(label) VALUES (?)').run(null);
  report.notNullViolation = null;
} catch (error) {
  report.notNullViolation = /NOT NULL/i.test(error instanceof Error ? error.message : String(error));
}
report.busyErrorOnPlainError = sqlite.isBusyError(new Error('no such table: nope'));

report.cachedHandleSame = sqlite.openMindosDatabase({ file: dbFile, migrations }) === db;
report.existsHandleSame = sqlite.openMindosDatabaseIfExists({ file: dbFile, migrations }) === db;

const memory = sqlite.openMindosMemoryDatabase('runtime-suite', migrations);
memory.prepare('INSERT INTO items(label) VALUES (?)').run('memory');
report.memoryCount = memory.prepare('SELECT count(*) AS n FROM items').get().n;
report.memoryDriver = memory.driver;

// Leases (spec-automations-lease-store) are the first consumer built purely on
// the public store API; a fixed clock makes acquire / block / renew / take-over
// / release deterministic so the Node and Bun reports must agree exactly.
const stateRoot = path.join(path.dirname(dbFile), 'state-root');
fs.mkdirSync(stateRoot, { recursive: true });
const stateDb = leases.openStateDatabase(stateRoot);
const t0 = 1_700_000_000_000;
const leaseKey = { kind: 'suite', key: 'lease' };
const first = leases.tryAcquireLease(stateDb, { ...leaseKey, ttlMs: 1000, owner: 'first', now: () => t0 });
const blocked = leases.tryAcquireLease(stateDb, { ...leaseKey, ttlMs: 1000, owner: 'second', now: () => t0 + 500 });
const renewed = first.ok ? leases.renewLease(stateDb, first.lease, 2000, () => t0 + 600) : null;
const stillBlocked = leases.tryAcquireLease(stateDb, { ...leaseKey, ttlMs: 1000, owner: 'second', now: () => t0 + 1500 });
const takenOver = leases.tryAcquireLease(stateDb, { ...leaseKey, ttlMs: 1000, owner: 'second', now: () => t0 + 2600 });
report.lease = {
  stateFileExists: fs.existsSync(path.join(stateRoot, '.mindos', 'db', 'state_1.sqlite')),
  acquired: first.ok,
  acquiredForMs: first.ok ? first.lease.leaseUntil - first.lease.acquiredAt : null,
  blockedBy: blocked.ok ? null : blocked.holder?.owner ?? null,
  renewedUntilOffsetMs: renewed ? renewed.leaseUntil - t0 : null,
  stillBlockedBy: stillBlocked.ok ? null : stillBlocked.holder?.owner ?? null,
  takenOverBy: takenOver.ok ? takenOver.lease.owner : null,
  staleOwnerRelease: first.ok ? leases.releaseLease(stateDb, first.lease) : null,
  ownerRelease: takenOver.ok ? leases.releaseLease(stateDb, takenOver.lease) : null,
  afterRelease: leases.readLease(stateDb, leaseKey),
};

db.close();
report.isOpenAfterClose = db.isOpen;
try {
  db.prepare('SELECT 1');
  report.closedError = null;
} catch (error) {
  report.closedError = error instanceof Error ? error.message.replace(dbFile, '<file>') : String(error);
}

const reopened = sqlite.openMindosDatabase({ file: dbFile, migrations });
report.reopenedIsNewHandle = reopened !== db;
report.reopenedCount = reopened.prepare('SELECT count(*) AS n FROM items').get().n;
report.reopenedMigrations = reopened.prepare('SELECT count(*) AS n FROM _migrations').get().n;
sqlite.closeAllMindosDatabases();
report.reopenedClosedByCloseAll = !reopened.isOpen && !memory.isOpen && !stateDb.isOpen;

process.stdout.write(JSON.stringify(report));
process.exit(0);
