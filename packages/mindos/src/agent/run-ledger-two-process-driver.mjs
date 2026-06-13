// Driver for run-ledger.two-process.test.ts. Runs as a REAL child process
// against the built dist/ output, so the test exercises genuine cross-process
// behavior instead of vitest module isolation. Not compiled by tsc (plain
// .mjs) and not collected by vitest (not a *.test.ts).
//
// argv: <distDir> <mindRoot> <mode> [...modeArgs]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distDir, mindRoot, mode, ...rest] = process.argv.slice(2);

const mindRootModule = await import(pathToFileURL(path.join(distDir, 'foundation/mind-root/index.js')).href);
mindRootModule.setMindRootResolverForTests(() => mindRoot);
const ledger = await import(pathToFileURL(path.join(distDir, 'agent/run-ledger.js')).href);

if (mode === 'start-and-exit') {
  // Start a run and exit without finishing it — simulates a crashed process.
  const run = ledger.startAgentRun({
    ...(rest[0] ? { id: rest[0] } : {}),
    agentKind: 'acp',
    runtimeId: 'crashed-proc',
    displayName: 'Crashed Process Run',
    permissionMode: 'readonly',
    inputSummary: 'run that never finishes',
  });
  process.stdout.write(JSON.stringify({ pid: process.pid, runId: run.id }));
  process.exit(0);
}

if (mode === 'append-many') {
  // rest: <prefix> <count> — start+complete `count` runs with summaries big
  // enough that this process's shard crosses the 1 MiB compaction threshold
  // mid-loop, so appends and own-shard compactions interleave for real.
  const [prefix, countRaw] = rest;
  const count = Number(countRaw);
  const big = 'y'.repeat(4000);
  for (let index = 0; index < count; index += 1) {
    const run = ledger.startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: `${prefix}-${index}`,
      displayName: `${prefix} ${index}`,
      permissionMode: 'readonly',
      inputSummary: `${prefix}:${index}:${big}`,
    });
    ledger.completeAgentRun(run.id, { outputSummary: `${prefix}:done:${index}:${big}` });
  }
  process.stdout.write(JSON.stringify({ pid: process.pid, count }));
  process.exit(0);
}

process.stderr.write(`unknown driver mode: ${mode}\n`);
process.exit(1);
