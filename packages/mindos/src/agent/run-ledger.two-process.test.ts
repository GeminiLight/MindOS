import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMindRootResolverForTests } from '../foundation/mind-root/index.js';
import {
  listAgentRuns,
  reloadAgentRunsFromDiskForTest,
  resetAgentRunsForTest,
} from './run-ledger.js';

/**
 * True multi-process ledger tests (spec-agent-core-consolidation 验收:
 * 真双进程测试). Children are real `node` processes importing the BUILT
 * dist/ ledger, each writing its own shard, so concurrent appends and
 * compactions hit the actual filesystem with genuinely distinct pids —
 * the strengthened successor of the 977728c6 foreign-append regression test.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..');
const distDir = path.join(pkgRoot, 'dist');
const driverPath = path.join(here, 'run-ledger-two-process-driver.mjs');

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

/** The drivers import dist/, so rebuild when src is newer than the build. */
function ensureFreshDist(): void {
  const probe = path.join(distDir, 'agent', 'run-ledger.js');
  const distMtime = fs.existsSync(probe) ? fs.statSync(probe).mtimeMs : -1;
  const srcMtime = Math.max(
    newestSourceMtime(path.join(pkgRoot, 'src', 'agent')),
    newestSourceMtime(path.join(pkgRoot, 'src', 'foundation')),
  );
  if (distMtime < srcMtime) {
    execFileSync(path.join(pkgRoot, 'node_modules', '.bin', 'tsc'), [], { cwd: pkgRoot, stdio: 'ignore' });
  }
}

function runDriver(mindRoot: string, mode: string, ...args: string[]): Promise<{ pid: number } & Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driverPath, distDir, mindRoot, mode, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`driver ${mode} exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as { pid: number } & Record<string, unknown>);
      } catch {
        reject(new Error(`driver ${mode} produced unparsable output: ${stdout}`));
      }
    });
  });
}

let root = '';

describe('agent run ledger across real processes', () => {
  beforeAll(() => {
    ensureFreshDist();
  }, 120_000);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ledger-2p-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
  });

  afterEach(() => {
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    reloadAgentRunsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('two processes appending and compacting concurrently lose none of each other\'s runs', async () => {
    const COUNT = 140;
    const [a, b] = await Promise.all([
      runDriver(root, 'append-many', 'proc-a', String(COUNT)),
      runDriver(root, 'append-many', 'proc-b', String(COUNT)),
    ]);
    expect(a.pid).not.toBe(b.pid);

    const shardFiles = fs.readdirSync(path.join(root, '.mindos'))
      .filter((name) => /^agent-run-ledger\.\d+-\d+\.jsonl$/.test(name));
    expect(shardFiles).toHaveLength(2);

    // Both children wrote enough to cross the 1 MiB threshold, so each shard
    // was compacted at least once while the other process kept appending.
    for (const name of shardFiles) {
      const firstLine = fs.readFileSync(path.join(root, '.mindos', name), 'utf-8').split('\n', 1)[0]!;
      expect(JSON.parse(firstLine)).toMatchObject({ version: 3, type: 'compact' });
    }

    reloadAgentRunsFromDiskForTest();
    const runs = listAgentRuns({ kind: 'pi-subagent', limit: 500 });
    expect(runs).toHaveLength(COUNT * 2);
    const runtimeIds = new Set(runs.map((run) => run.runtimeId));
    for (let index = 0; index < COUNT; index += 1) {
      expect(runtimeIds.has(`proc-a-${index}`)).toBe(true);
      expect(runtimeIds.has(`proc-b-${index}`)).toBe(true);
    }
    expect(runs.every((run) => run.status === 'completed')).toBe(true);
  }, 60_000);

  it('a run whose owning process exited mid-flight is failed on the next read, shard untouched', async () => {
    const result = await runDriver(root, 'start-and-exit', 'agent-run-2p-orphan');
    const shardFiles = fs.readdirSync(path.join(root, '.mindos'))
      .filter((name) => name.startsWith(`agent-run-ledger.${result.pid}-`));
    expect(shardFiles).toHaveLength(1);
    const shardPath = path.join(root, '.mindos', shardFiles[0]!);
    const rawBefore = fs.readFileSync(shardPath, 'utf-8');
    expect(rawBefore).toContain('"status":"running"');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-2p-orphan' })).toEqual([
      expect.objectContaining({
        id: 'agent-run-2p-orphan',
        status: 'failed',
        error: expect.stringContaining('exited'),
        metadata: expect.objectContaining({ failureReason: 'process-died' }),
      }),
    ]);
    // The dead process's shard is evidence, not something we rewrite.
    expect(fs.readFileSync(shardPath, 'utf-8')).toBe(rawBefore);
  }, 60_000);
});
