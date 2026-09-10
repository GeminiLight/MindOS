// Driver for runtime-control-plane.two-process.test.ts. Runs as a REAL child
// process against the built dist/ output so the control-plane lease is
// contended by processes with genuinely distinct pids. Not compiled by tsc
// (plain .mjs) and not collected by vitest (not a *.test.ts).
//
// argv: <distDir> <mindRoot> <mode> [...modeArgs]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distDir, mindRoot, mode, ...rest] = process.argv.slice(2);

const controlPlane = await import(pathToFileURL(path.join(distDir, 'server/handlers/runtime-control-plane.js')).href);

function finish(payload) {
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...payload })}\n`, () => process.exit(0));
}

if (mode === 'upsert-many') {
  // Each iteration is a full read-modify-write of runtime-control-plane.json;
  // a lost update shows up as fewer tasks than both processes wrote.
  const prefix = rest[0];
  const count = Number(rest[1]);
  for (let index = 0; index < count; index += 1) {
    const result = controlPlane.applyRuntimeControlPlaneMutation(mindRoot, {
      action: 'upsert-task',
      task: { id: `${prefix}-${index}`, title: `Task ${prefix} ${index}` },
    });
    if ('error' in result) {
      process.stderr.write(`upsert-many: ${result.error}\n`);
      process.exit(2);
    }
  }
  finish({ prefix, count });
}

if (mode !== 'upsert-many') {
  process.stderr.write(`unknown driver mode: ${mode}\n`);
  process.exit(1);
}
