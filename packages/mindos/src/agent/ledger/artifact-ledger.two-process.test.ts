import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { ensureFreshDist, runDriver } from './__fixtures__/two-process-harness.mjs';
import { LEDGER_DB_RELATIVE_PATH } from './run-ledger-db.js';
import {
  appendAgentArtifact,
  listAgentArtifacts,
  reloadAgentArtifactsFromDiskForTest,
  resetAgentArtifactsForTest,
} from './artifact-ledger.js';

/**
 * Real multi-process artifact ledger tests (spec-ledger-write-cost P2): the
 * pre-spec ledger merged per-process JSONL shards into a process-global cache
 * once and never re-read, so a sibling process's artifacts were invisible
 * until restart. Children are genuine `node` processes importing dist/.
 */

let root = '';

describe('agent artifact ledger across real processes', () => {
  beforeAll(() => {
    ensureFreshDist();
  }, 120_000);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-artifacts-2p-'));
    setMindRootResolverForTests(() => root);
    resetAgentArtifactsForTest();
  });

  afterEach(() => {
    resetAgentArtifactsForTest();
    setMindRootResolverForTests(null);
    reloadAgentArtifactsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('artifacts recorded by a child process are visible to the parent without a restart, and vice versa', async () => {
    // Parent reads first so the child's write is not observed through a cold open.
    expect(listAgentArtifacts()).toEqual([]);

    const child = await runDriver(root, 'artifact-append', 'child-runtime', 'run-child', '3');
    expect(child.pid).not.toBe(process.pid);
    expect(child.ids).toHaveLength(3);
    expect(listAgentArtifacts({ runtimeId: 'child-runtime' }).map((record) => record.path).sort()).toEqual([
      '/tmp/child-runtime/file-0.md',
      '/tmp/child-runtime/file-1.md',
      '/tmp/child-runtime/file-2.md',
    ]);
    expect(listAgentArtifacts({ runId: 'run-child' })).toHaveLength(3);

    appendAgentArtifact({
      runtimeId: 'parent-runtime',
      agentKind: 'native-runtime',
      source: 'runtime-output',
      kind: 'diff',
      runId: 'run-parent',
      path: '/tmp/parent/changes.diff',
      title: 'Parent diff',
    });
    const seenByChild = await runDriver(root, 'artifact-list', 'parent-runtime');
    expect(seenByChild.artifacts).toEqual([
      expect.objectContaining({ path: '/tmp/parent/changes.diff', title: 'Parent diff' }),
    ]);

    // Everything lives in the shared ledger database; no per-process shard files.
    const mindosDir = fs.readdirSync(path.join(root, '.mindos'));
    expect(mindosDir.filter((name) => name.startsWith('agent-artifact-ledger.'))).toEqual([]);
    expect(fs.existsSync(path.join(root, ...LEDGER_DB_RELATIVE_PATH.split('/')))).toBe(true);
  }, 60_000);

  it('two processes appending concurrently lose none of each other\'s artifacts', async () => {
    const COUNT = 120;
    const [a, b] = await Promise.all([
      runDriver(root, 'artifact-append', 'proc-a', 'run-a', String(COUNT)),
      runDriver(root, 'artifact-append', 'proc-b', 'run-b', String(COUNT)),
    ]);
    expect(a.pid).not.toBe(b.pid);
    expect(listAgentArtifacts({ runtimeId: 'proc-a' })).toHaveLength(COUNT);
    expect(listAgentArtifacts({ runtimeId: 'proc-b' })).toHaveLength(COUNT);
    expect(listAgentArtifacts({ limit: 1000 })).toHaveLength(COUNT * 2);
  }, 60_000);
});
