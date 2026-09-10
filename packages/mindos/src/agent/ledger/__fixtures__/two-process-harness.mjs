// Shared harness for the real multi-process ledger tests
// (run-ledger.two-process.test.ts, artifact-ledger.two-process.test.ts).
// Children are genuine `node` (or `bun`) processes importing the BUILT dist/
// output through run-ledger-two-process-driver.mjs, so the suites exercise
// cross-process behaviour instead of vitest module isolation. Plain .mjs like
// the other __fixtures__: not compiled into dist, not collected by vitest.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..', '..', '..');

export const distDir = path.join(pkgRoot, 'dist');
export const driverPath = path.join(here, '..', 'run-ledger-two-process-driver.mjs');

function newestSourceMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  return newest;
}

/** The drivers import dist/, so rebuild when src is newer than the build. */
export function ensureFreshDist() {
  const probe = path.join(distDir, 'agent', 'ledger', 'run-ledger.js');
  const distMtime = fs.existsSync(probe) ? fs.statSync(probe).mtimeMs : -1;
  const srcMtime = Math.max(
    newestSourceMtime(path.join(pkgRoot, 'src', 'agent')),
    newestSourceMtime(path.join(pkgRoot, 'src', 'foundation')),
  );
  if (distMtime < srcMtime) {
    execFileSync(path.join(pkgRoot, 'node_modules', '.bin', 'tsc'), [], { cwd: pkgRoot, stdio: 'ignore' });
  }
}

/** Absolute path of `bun` on PATH, or null (mixed-runtime cases are then skipped). */
export function findBun() {
  if (process.env.MINDOS_TEST_SKIP_BUN === '1') return null;
  const names = process.platform === 'win32' ? ['bun.exe', 'bun.cmd', 'bun'] : ['bun'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
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

export function runDriverWith(execPath, mindRoot, mode, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(execPath, [driverPath, distDir, mindRoot, mode, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`driver ${mode} exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`driver ${mode} produced unparsable output: ${stdout}`));
      }
    });
  });
}

export function runDriver(mindRoot, mode, ...args) {
  return runDriverWith(process.execPath, mindRoot, mode, ...args);
}
