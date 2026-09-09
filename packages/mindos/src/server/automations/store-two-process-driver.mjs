// Driver for store.two-process.test.ts. Runs as a REAL child process against
// the built dist/ output so the automation state lease is contended by
// processes with genuinely distinct pids. Not compiled by tsc (plain .mjs) and
// not collected by vitest (not a *.test.ts).
//
// argv: <distDir> <mindRoot> <mode> [...modeArgs]
// Modes print a final JSON line; `hold-lease` first prints a `ready` line once
// the lease is held so the parent can start contending.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distDir, mindRoot, mode, ...rest] = process.argv.slice(2);

const store = await import(pathToFileURL(path.join(distDir, 'server/automations/store.js')).href);
const leases = await import(pathToFileURL(path.join(distDir, 'foundation/storage/leases.js')).href);

function finish(payload) {
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...payload })}\n`, () => process.exit(0));
}

if (mode === 'increment-many') {
  // Each iteration is a full read-modify-write of state.json; a lost update
  // shows up as a final count below the sum of both processes.
  const count = Number(rest[0]);
  for (let index = 0; index < count; index += 1) {
    store.mutateStudioAutomationState(mindRoot, (state) => { state.migration.importedCount += 1; });
  }
  finish({ count });
}

if (mode === 'hold-lease') {
  // Hold the store's lease for `holdMs` without writing, then release it.
  const holdMs = Number(rest[0]);
  const db = leases.openStateDatabase(mindRoot);
  const result = leases.tryAcquireLease(db, { ...store.STUDIO_AUTOMATION_STATE_LEASE, ttlMs: 30_000 });
  if (!result.ok) {
    process.stderr.write('hold-lease: lease already held\n');
    process.exit(2);
  }
  process.stdout.write('ready\n');
  // setTimeout (not a busy loop) so the ready line is flushed on platforms
  // where a pipe write is asynchronous.
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  const releasedAt = Date.now();
  leases.releaseLease(db, result.lease);
  finish({ releasedAt });
}

if (mode === 'acquire-and-exit') {
  // Take the lease with a short ttl and exit without releasing: a crashed
  // writer. The parent must be able to take over once the ttl passes.
  const ttlMs = Number(rest[0]);
  const db = leases.openStateDatabase(mindRoot);
  const result = leases.tryAcquireLease(db, { ...store.STUDIO_AUTOMATION_STATE_LEASE, ttlMs });
  if (!result.ok) {
    process.stderr.write('acquire-and-exit: lease already held\n');
    process.exit(2);
  }
  finish({ lease: result.lease });
}

if (!['increment-many', 'hold-lease', 'acquire-and-exit'].includes(mode)) {
  process.stderr.write(`unknown driver mode: ${mode}\n`);
  process.exit(1);
}
