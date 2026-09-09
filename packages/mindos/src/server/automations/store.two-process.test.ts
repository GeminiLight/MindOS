import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAllMindosDatabases } from '../../foundation/storage/sqlite.js';
import { openStateDatabase, readLease, type Lease } from '../../foundation/storage/leases.js';
import {
  STUDIO_AUTOMATION_STATE_LEASE,
  mutateStudioAutomationState,
  readStudioAutomationState,
} from './store.js';

/**
 * True multi-process tests for the automation state lease
 * (spec-automations-lease-store). Children are real `node` processes importing
 * the BUILT dist/ store, so two writers with distinct pids contend for the same
 * `.mindos/db/state_1.sqlite` lease and the same `state.json`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..', '..');
const distDir = path.join(pkgRoot, 'dist');
const driverPath = path.join(here, 'store-two-process-driver.mjs');

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
  const probe = path.join(distDir, 'server', 'automations', 'store.js');
  const distMtime = fs.existsSync(probe) ? fs.statSync(probe).mtimeMs : -1;
  const srcMtime = Math.max(
    newestSourceMtime(path.join(pkgRoot, 'src', 'server', 'automations')),
    newestSourceMtime(path.join(pkgRoot, 'src', 'foundation')),
    newestSourceMtime(path.join(pkgRoot, 'src', 'agent')),
  );
  if (distMtime < srcMtime) {
    execFileSync(path.join(pkgRoot, 'node_modules', '.bin', 'tsc'), [], { cwd: pkgRoot, stdio: 'ignore' });
  }
}

type DriverResult = { pid: number } & Record<string, unknown>;

type DriverHandle = {
  /** Resolves once the child printed its `ready` line (hold-lease only). */
  ready: Promise<void>;
  /** Resolves with the final JSON line once the child exits cleanly. */
  done: Promise<DriverResult>;
};

function runDriver(mindRoot: string, mode: string, ...args: string[]): DriverHandle {
  const child = spawn(process.execPath, [driverPath, distDir, mindRoot, mode, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    if (stdout.includes('ready\n')) markReady();
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const done = new Promise<DriverResult>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      markReady();
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
  return { ready, done };
}

let root = '';

describe('studio automation state lease across real processes', () => {
  beforeAll(() => {
    ensureFreshDist();
  }, 120_000);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-automation-lease-2p-'));
  });

  afterEach(() => {
    closeAllMindosDatabases();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('two processes doing read-modify-write in parallel never lose an increment', async () => {
    const COUNT = 100;
    const [a, b] = await Promise.all([
      runDriver(root, 'increment-many', String(COUNT)).done,
      runDriver(root, 'increment-many', String(COUNT)).done,
    ]);
    expect(a.pid).not.toBe(b.pid);
    expect(a.pid).not.toBe(process.pid);

    expect(readStudioAutomationState(root).migration.importedCount).toBe(COUNT * 2);
    expect(fs.existsSync(path.join(root, '.mindos', 'automations', 'state.lock'))).toBe(false);
    expect(fs.readdirSync(path.join(root, '.mindos', 'automations')).filter((name) => name.includes('.lock'))).toEqual([]);
    expect(readLease(openStateDatabase(root), STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
  }, 60_000);

  it('a mutation waits for a lease held by another live process and enters only after it is released', async () => {
    const holder = runDriver(root, 'hold-lease', '500');
    await holder.ready;
    const db = openStateDatabase(root);
    const heldBy = readLease(db, STUDIO_AUTOMATION_STATE_LEASE);
    expect(heldBy?.owner).toMatch(/^pid-\d+-/);
    expect(heldBy?.owner.startsWith(`pid-${process.pid}-`)).toBe(false);

    let enteredAt = 0;
    mutateStudioAutomationState(root, (state) => {
      enteredAt = Date.now();
      state.migration.importedCount = 1;
    });
    const result = await holder.done;

    expect(result.pid).not.toBe(process.pid);
    expect(enteredAt).toBeGreaterThanOrEqual(result.releasedAt as number);
    expect(readStudioAutomationState(root).migration.importedCount).toBe(1);
    expect(readLease(db, STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
  }, 60_000);

  it('a lease whose owner exited without releasing is taken over once it expires', async () => {
    const TTL_MS = 400;
    const crashed = await runDriver(root, 'acquire-and-exit', String(TTL_MS)).done;
    const orphan = crashed.lease as Lease;
    expect(crashed.pid).not.toBe(process.pid);
    const db = openStateDatabase(root);
    expect(readLease(db, STUDIO_AUTOMATION_STATE_LEASE)).toEqual(orphan);

    mutateStudioAutomationState(root, (state) => { state.migration.importedCount = 7; });

    expect(Date.now()).toBeGreaterThanOrEqual(orphan.leaseUntil);
    expect(readLease(db, STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
    expect(readStudioAutomationState(root).migration.importedCount).toBe(7);
  }, 60_000);
});
