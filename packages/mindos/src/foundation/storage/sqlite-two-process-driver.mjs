// Driver for sqlite.test.ts. Runs as a REAL child process against the built
// dist/ output so concurrent writers and busy-timeout behaviour are exercised
// across genuine processes instead of vitest module isolation. Not compiled by
// tsc (plain .mjs) and not collected by vitest (not a *.test.ts).
//
// argv: <distDir> <dbFile> <mode> [...modeArgs]
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
  db.close();
  process.stdout.write(JSON.stringify({ pid: process.pid, count }));
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

process.stderr.write(`unknown driver mode: ${mode}\n`);
process.exit(1);
