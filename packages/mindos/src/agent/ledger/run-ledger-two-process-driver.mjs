// Driver for run-ledger.two-process.test.ts. Runs as a REAL child process
// against the built dist/ output, so the test exercises genuine cross-process
// behavior (shared WAL-mode sqlite file, distinct pids) instead of vitest
// module isolation. Not compiled by tsc (plain .mjs) and not collected by
// vitest (not a *.test.ts).
//
// argv: <distDir> <mindRoot> <mode> [...modeArgs]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distDir, mindRoot, mode, ...rest] = process.argv.slice(2);

const mindRootModule = await import(pathToFileURL(path.join(distDir, 'foundation/mind-root/index.js')).href);
mindRootModule.setMindRootResolverForTests(() => mindRoot);
const ledger = await import(pathToFileURL(path.join(distDir, 'agent/run-ledger.js')).href);

// Reported so the coordinator can prove which runtime actually executed.
const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';

if (mode === 'start-and-exit') {
  // Start a run and exit without finishing it — simulates a crashed process.
  const run = ledger.startAgentRun({
    ...(rest[0] ? { id: rest[0] } : {}),
    agentKind: 'acp',
    runtimeId: 'crashed-proc',
    displayName: 'Crashed Process Run',
    permissionMode: 'read',
    inputSummary: 'run that never finishes',
  });
  process.stdout.write(JSON.stringify({ pid: process.pid, runtime, runId: run.id }));
  process.exit(0);
}

if (mode === 'start-and-complete') {
  // Start and finish one run so the parent can observe it without restarting.
  const run = ledger.startAgentRun({
    ...(rest[0] ? { id: rest[0] } : {}),
    agentKind: 'acp',
    runtimeId: 'child-proc',
    displayName: 'Child Process Run',
    permissionMode: 'read',
    inputSummary: 'created by a child process',
  });
  ledger.appendAgentRunEvent(run.id, { type: 'text', category: 'text', message: 'child says hello' });
  ledger.completeAgentRun(run.id, { outputSummary: 'child done' });
  process.stdout.write(JSON.stringify({ pid: process.pid, runtime, runId: run.id }));
  process.exit(0);
}

if (mode === 'get-run') {
  // Read a run the parent created; proves the parent's writes are visible here.
  const record = ledger.getAgentRun(rest[0]);
  const events = ledger.listAgentEvents({ runId: rest[0] }).map((event) => event.type);
  process.stdout.write(JSON.stringify({ pid: process.pid, runtime, record: record ?? null, events }));
  process.exit(0);
}

if (mode === 'append-many') {
  // rest: <prefix> <count> — start+complete `count` runs with large summaries
  // while a sibling process does the same against the same database file, so
  // writes from two processes interleave for real.
  const [prefix, countRaw] = rest;
  const count = Number(countRaw);
  const big = 'y'.repeat(4000);
  for (let index = 0; index < count; index += 1) {
    const run = ledger.startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: `${prefix}-${index}`,
      displayName: `${prefix} ${index}`,
      permissionMode: 'read',
      inputSummary: `${prefix}:${index}:${big}`,
    });
    ledger.completeAgentRun(run.id, { outputSummary: `${prefix}:done:${index}:${big}` });
  }
  process.stdout.write(JSON.stringify({ pid: process.pid, runtime, count }));
  process.exit(0);
}

if (mode === 'artifact-append') {
  // rest: <runtimeId> <runId> <count> — record `count` artifact pointers so a
  // sibling process can observe them through the shared ledger database.
  const artifacts = await import(pathToFileURL(path.join(distDir, 'agent/ledger/artifact-ledger.js')).href);
  const [runtimeId, runId, countRaw] = rest;
  const count = Number(countRaw);
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const record = artifacts.appendAgentArtifact({
      runtimeId,
      agentKind: 'native-runtime',
      source: 'runtime-output',
      kind: 'file',
      status: 'completed',
      runId,
      path: `/tmp/${runtimeId}/file-${index}.md`,
      title: `${runtimeId} artifact ${index}`,
    });
    if (record) ids.push(record.id);
  }
  process.stdout.write(JSON.stringify({ pid: process.pid, runtime, ids }));
  process.exit(0);
}

if (mode === 'artifact-list') {
  // rest: <runtimeId> — read artifacts the parent recorded; proves visibility here.
  const artifacts = await import(pathToFileURL(path.join(distDir, 'agent/ledger/artifact-ledger.js')).href);
  const records = artifacts.listAgentArtifacts({ runtimeId: rest[0] })
    .map((record) => ({ id: record.id, path: record.path, title: record.title }));
  process.stdout.write(JSON.stringify({ pid: process.pid, runtime, artifacts: records }));
  process.exit(0);
}

process.stderr.write(`unknown driver mode: ${mode}\n`);
process.exit(1);
