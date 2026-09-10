import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAllMindosDatabases } from '../../foundation/storage/sqlite.js';
import { openStateDatabase, readLease } from '../../foundation/storage/leases.js';
import { RUNTIME_CONTROL_PLANE_LEASE, readRuntimeControlPlane } from './runtime-control-plane.js';

/**
 * True multi-process test for the runtime control-plane lease. Children are
 * real `node` processes importing the BUILT dist/ handler, so two writers with
 * distinct pids contend for the same `.mindos/db/state_1.sqlite` lease and the
 * same `runtime-control-plane.json` (mirrors automations/store.two-process).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..', '..');
const distDir = path.join(pkgRoot, 'dist');
const driverPath = path.join(here, 'runtime-control-plane-two-process-driver.mjs');

function newestSourceMtime(dir: string): number {
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

/** The driver imports dist/, so rebuild when src is newer than the build. */
function ensureFreshDist(): void {
  const probe = path.join(distDir, 'server', 'handlers', 'runtime-control-plane.js');
  const distMtime = fs.existsSync(probe) ? fs.statSync(probe).mtimeMs : -1;
  const srcMtime = Math.max(
    newestSourceMtime(path.join(pkgRoot, 'src', 'server', 'handlers')),
    newestSourceMtime(path.join(pkgRoot, 'src', 'foundation')),
    newestSourceMtime(path.join(pkgRoot, 'src', 'agent')),
  );
  if (distMtime < srcMtime) {
    execFileSync(path.join(pkgRoot, 'node_modules', '.bin', 'tsc'), [], { cwd: pkgRoot, stdio: 'ignore' });
  }
}

type DriverResult = { pid: number } & Record<string, unknown>;

function runDriver(mindRoot: string, mode: string, ...args: string[]): Promise<DriverResult> {
  const child = spawn(process.execPath, [driverPath, distDir, mindRoot, mode, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  return new Promise<DriverResult>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`driver ${mode} exited with ${code}: ${stderr}`));
        return;
      }
      const last = stdout.trim().split('\n').at(-1) ?? '';
      try {
        resolve(JSON.parse(last) as DriverResult);
      } catch {
        reject(new Error(`driver ${mode} produced unparsable output: ${stdout}`));
      }
    });
  });
}

let root = '';

describe('runtime control-plane lease across real processes', () => {
  beforeAll(() => {
    ensureFreshDist();
  }, 180_000);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-control-plane-2p-'));
  });

  afterEach(() => {
    closeAllMindosDatabases();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('two processes upserting tasks in parallel never lose a write', async () => {
    const COUNT = 100;
    const [a, b] = await Promise.all([
      runDriver(root, 'upsert-many', 'a', String(COUNT)),
      runDriver(root, 'upsert-many', 'b', String(COUNT)),
    ]);
    expect(a.pid).not.toBe(b.pid);
    expect(a.pid).not.toBe(process.pid);

    const snapshot = readRuntimeControlPlane(root);
    expect(snapshot.tasks).toHaveLength(COUNT * 2);
    const ids = new Set(snapshot.tasks.map((task) => task.id));
    for (let index = 0; index < COUNT; index += 1) {
      expect(ids.has(`a-${index}`)).toBe(true);
      expect(ids.has(`b-${index}`)).toBe(true);
    }
    expect(fs.readdirSync(path.join(root, '.mindos')).filter((name) => name.includes('.tmp'))).toEqual([]);
    expect(readLease(openStateDatabase(root), RUNTIME_CONTROL_PLANE_LEASE)).toBeNull();
  }, 60_000);
});
