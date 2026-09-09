// Driver for sqlite.test.ts. Runs as a REAL child process against the built
// dist/ output so concurrent writers and busy-timeout behaviour are exercised
// across genuine processes instead of vitest module isolation. Not compiled by
// tsc (plain .mjs) and not collected by vitest (not a *.test.ts).
//
// argv: <distDir> <dbFile> <mode> [...modeArgs]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distDir, dbFile, mode, ...rest] = process.argv.slice(2);
const sqlite = await import(pathToFileURL(path.join(distDir, 'foundation/storage/sqlite.js')).href);

const migrations = [
  { version: 1, sql: 'CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT NOT NULL);' },
  { version: 2, sql: 'CREATE INDEX idx_items_label ON items(label);' },
];

if (mode === 'insert-many') {
  const [prefix, countRaw] = rest;
  const count = Number(countRaw);
  // Measured from before open(): a sibling holding the write lock makes the
  // migration transaction inside open() wait, and the coordinator asserts on
  // that wait rather than on a fast failure.
  const startedAt = Date.now();
  const db = sqlite.openMindosDatabase({ file: dbFile, migrations });
  const insert = db.prepare('INSERT INTO items(label) VALUES (?)');
  for (let index = 0; index < count; index += 1) {
    // Alternate between single statements and small transactions so both
    // paths contend for the write lock with the sibling process.
    if (index % 7 === 0) {
      db.transaction(() => {
        insert.run(`${prefix}-${index}`);
      });
    } else {
      insert.run(`${prefix}-${index}`);
    }
  }
  const elapsedMs = Date.now() - startedAt;
  db.close();
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    count,
    elapsedMs,
    runtime: typeof Bun !== 'undefined' ? 'bun' : 'node',
    driver: db.driver,
  }));
  process.exit(0);
}

if (mode === 'open-only') {
  // Open (create + migrate) and close immediately: the whole process lifetime
  // is the initialization race the coordinator wants several siblings to hit.
  const db = sqlite.openMindosDatabase({ file: dbFile, migrations });
  const journal = db.prepare('PRAGMA journal_mode').get();
  const versions = db.prepare('SELECT count(*) AS n FROM _migrations').get();
  db.close();
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    journal: journal.journal_mode,
    migrations: versions.n,
    runtime: typeof Bun !== 'undefined' ? 'bun' : 'node',
    driver: db.driver,
  }));
  process.exit(0);
}

if (mode === 'hold-write-lock') {
  const holdMs = Number(rest[0]);
  const db = sqlite.openMindosDatabase({ file: dbFile, migrations });
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO items(label) VALUES (?)').run('holder-row');
  const until = Date.now() + holdMs;
  while (Date.now() < until) {
    // Busy-wait: keep the write transaction open without yielding the lock.
  }
  db.exec('COMMIT');
  db.close();
  process.stdout.write(JSON.stringify({ pid: process.pid, held: true }));
  process.exit(0);
}

// Lease modes treat <dbFile> as a mind root: the lease table lives in that
// root's .mindos/db/state_1.sqlite (foundation/storage/leases.ts).
const LEASE = { kind: 'suite', key: 'shared', ttlMs: 5000 };

if (mode === 'hold-lease') {
  // rest: <holdMs> <owner> — take the lease, publish a marker file so the
  // coordinator knows it is held, keep it while busy-waiting, then release.
  const [holdMsRaw, owner] = rest;
  const leases = await import(pathToFileURL(path.join(distDir, 'foundation/storage/leases.js')).href);
  const db = leases.openStateDatabase(dbFile);
  const result = leases.tryAcquireLease(db, { ...LEASE, owner });
  if (!result.ok) {
    process.stderr.write(`hold-lease: lease already held by ${result.holder?.owner}\n`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(dbFile, 'lease-held'), owner);
  const until = Date.now() + Number(holdMsRaw);
  while (Date.now() < until) {
    // Busy-wait: keep the lease without releasing or renewing it.
  }
  const released = leases.releaseLease(db, result.lease);
  db.close();
  process.stdout.write(JSON.stringify({ pid: process.pid, runtime: typeof Bun !== 'undefined' ? 'bun' : 'node', owner, released }));
  process.exit(0);
}

if (mode === 'acquire-lease') {
  // rest: <owner> <waitMs> — block in acquireLease until the holder releases.
  const [owner, waitMsRaw] = rest;
  const leases = await import(pathToFileURL(path.join(distDir, 'foundation/storage/leases.js')).href);
  const db = leases.openStateDatabase(dbFile);
  const startedAt = Date.now();
  const lease = leases.acquireLease(db, { ...LEASE, owner, waitMs: Number(waitMsRaw) });
  const elapsedMs = Date.now() - startedAt;
  const released = leases.releaseLease(db, lease);
  db.close();
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    runtime: typeof Bun !== 'undefined' ? 'bun' : 'node',
    owner: lease.owner,
    elapsedMs,
    released,
  }));
  process.exit(0);
}

process.stderr.write(`unknown driver mode: ${mode}\n`);
process.exit(1);
