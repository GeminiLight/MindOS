import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { openMindosDatabase } from '../../foundation/storage/sqlite.js';
import { ledgerDatabaseFile } from './run-ledger-db.js';
import {
  appendAgentArtifact,
  listAgentArtifacts,
  recordArtifactsFromAcpToolCall,
  reloadAgentArtifactsFromDiskForTest,
  resetAgentArtifactsForTest,
  type AgentArtifactLedgerRecord,
} from './artifact-ledger.js';

let root = '';

function mindosDir(): string {
  return path.join(root, '.mindos');
}

function shardFileNames(): string[] {
  return fs.existsSync(mindosDir())
    ? fs.readdirSync(mindosDir()).filter((name) => name.startsWith('agent-artifact-ledger.')).sort()
    : [];
}

/** A shard as written by a pre-sqlite MindOS process. */
function writeLegacyShard(pid: number, startTs: number, records: AgentArtifactLedgerRecord[]): string {
  fs.mkdirSync(mindosDir(), { recursive: true });
  const file = path.join(mindosDir(), `agent-artifact-ledger.${pid}-${startTs}.jsonl`);
  const lines = records.map((record) => JSON.stringify({ version: 1, type: 'artifact_upsert', ts: record.updatedAt, record }));
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');
  return file;
}

function legacyRecord(overrides: Partial<AgentArtifactLedgerRecord> & { id: string }): AgentArtifactLedgerRecord {
  return {
    schemaVersion: 1,
    runtimeId: 'legacy-runtime',
    agentKind: 'native-runtime',
    source: 'runtime-output',
    kind: 'file',
    status: 'completed',
    createdAt: 1_000,
    updatedAt: 1_000,
    path: `/tmp/legacy/${overrides.id}.md`,
    ...overrides,
  };
}

/** A pid that is guaranteed dead: a child that already ran to completion. */
function deadPid(): number {
  const result = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  if (typeof result.pid !== 'number') throw new Error('failed to spawn probe child');
  return result.pid;
}

function fileArtifact(index: number, overrides: Partial<Parameters<typeof appendAgentArtifact>[0]> = {}) {
  return appendAgentArtifact({
    runtimeId: 'codex',
    agentKind: 'native-runtime',
    source: 'runtime-output',
    kind: 'file',
    status: 'completed',
    runId: 'run-1',
    path: `/tmp/project/file-${index}.md`,
    ...overrides,
  });
}

describe('agent artifact ledger', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-artifact-ledger-'));
    fs.mkdirSync(path.join(root, '.mindos'), { recursive: true });
    setMindRootResolverForTests(() => root);
    resetAgentArtifactsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetAgentArtifactsForTest();
    setMindRootResolverForTests(null);
    reloadAgentArtifactsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('stores artifact pointers in the run ledger database, merges updates by id, and survives a reload', () => {
    const first = appendAgentArtifact({
      runtimeId: 'codex',
      agentKind: 'native-runtime',
      source: 'runtime-output',
      kind: 'diff',
      status: 'completed',
      runId: 'run-1',
      path: '/tmp/project/changes.diff',
      title: 'Generated diff',
    });
    const updated = appendAgentArtifact({
      runtimeId: 'codex',
      agentKind: 'native-runtime',
      source: 'runtime-output',
      kind: 'diff',
      status: 'completed',
      runId: 'run-1',
      path: '/tmp/project/changes.diff',
      title: 'Updated diff',
      metadata: { token: 'secret-token-value' },
    });

    expect(first?.id).toBe(updated?.id);
    expect(updated?.createdAt).toBe(first?.createdAt);
    expect(listAgentArtifacts({ runtimeId: 'codex' })).toEqual([
      expect.objectContaining({
        id: first?.id,
        runtimeId: 'codex',
        kind: 'diff',
        path: '/tmp/project/changes.diff',
        title: 'Updated diff',
      }),
    ]);
    expect(JSON.stringify(listAgentArtifacts())).not.toContain('secret-token-value');

    // Persisted in the shared ledger database, not in a per-process shard.
    expect(fs.existsSync(ledgerDatabaseFile(root))).toBe(true);
    expect(shardFileNames()).toEqual([]);
    const rawJson = openMindosDatabase({ file: ledgerDatabaseFile(root), migrations: [] })
      .prepare('SELECT artifact_json FROM agent_artifacts WHERE id = ?').get(first!.id) as { artifact_json: string };
    expect(rawJson.artifact_json).not.toContain('secret-token-value');

    resetAgentArtifactsForTest();
    reloadAgentArtifactsFromDiskForTest();
    expect(listAgentArtifacts({ runtimeId: 'codex' })).toEqual([
      expect.objectContaining({
        id: first?.id,
        path: '/tmp/project/changes.diff',
        title: 'Updated diff',
      }),
    ]);
  });

  it('extracts ACP tool location pointers without storing raw blobs', () => {
    const hugeImage = `data:image/png;base64,${'a'.repeat(80_000)}`;
    const records = recordArtifactsFromAcpToolCall({
      runtimeId: 'declared-acp',
      sessionId: 'ses-1',
      externalSessionId: 'agent-ses-1',
      cwd: '/tmp/project',
      toolCall: {
        toolCallId: 'tool-1',
        title: 'Edit README',
        kind: 'edit',
        status: 'completed',
        rawOutput: hugeImage,
        locations: [
          { path: '/tmp/project/README.md', line: 7 },
          { path: '/tmp/project/README.md', line: 7 },
          { path: '/tmp/project/screenshot.png' },
        ],
        content: [
          { type: 'resource_link', uri: 'file:///tmp/project/report.md', name: 'report.md' },
          { type: 'image', data: hugeImage, mimeType: 'image/png' },
        ],
      },
    });

    expect(records).toHaveLength(3);
    expect(listAgentArtifacts({ runtimeId: 'declared-acp', toolCallId: 'tool-1' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/tmp/project/README.md', line: 7, kind: 'file' }),
      expect.objectContaining({ path: '/tmp/project/screenshot.png', kind: 'image' }),
      expect.objectContaining({ path: '/tmp/project/report.md', uri: 'file:///tmp/project/report.md', kind: 'file' }),
    ]));
    expect(JSON.stringify(listAgentArtifacts())).not.toContain(hugeImage.slice(0, 100));
  });

  it('filters on indexed columns and lists the most recently updated artifact first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const oldest = fileArtifact(0, { runId: 'run-a', toolCallId: 'tool-a', kind: 'file' });
    vi.setSystemTime(2_000);
    const middle = fileArtifact(1, { runId: 'run-b', toolCallId: 'tool-b', kind: 'image', path: '/tmp/project/shot.png' });
    vi.setSystemTime(3_000);
    const newest = fileArtifact(2, { runId: 'run-a', toolCallId: 'tool-c', source: 'manual' });
    vi.setSystemTime(4_000);
    // Touching the oldest moves it to the front: the list is ordered by last update.
    fileArtifact(0, { runId: 'run-a', toolCallId: 'tool-a', kind: 'file', title: 'touched' });

    expect(listAgentArtifacts().map((record) => record.id)).toEqual([oldest!.id, newest!.id, middle!.id]);
    expect(listAgentArtifacts({ runId: 'run-a' }).map((record) => record.id)).toEqual([oldest!.id, newest!.id]);
    expect(listAgentArtifacts({ runId: 'run-a', kind: 'file', source: 'runtime-output' }).map((record) => record.id)).toEqual([oldest!.id]);
    expect(listAgentArtifacts({ toolCallId: 'tool-b' }).map((record) => record.id)).toEqual([middle!.id]);
    expect(listAgentArtifacts({ source: 'manual' }).map((record) => record.id)).toEqual([newest!.id]);
    expect(listAgentArtifacts({ limit: 1 }).map((record) => record.id)).toEqual([oldest!.id]);
    expect(listAgentArtifacts({ runtimeId: 'nobody' })).toEqual([]);
    expect(listAgentArtifacts()[0]).toEqual(expect.objectContaining({ title: 'touched', createdAt: 1_000, updatedAt: 4_000 }));
  });

  it('sees artifacts written by another handle after its own cache was populated', () => {
    fileArtifact(0);
    expect(listAgentArtifacts()).toHaveLength(1);
    // Simulate a sibling process: write straight into the shared table.
    const db = openMindosDatabase({ file: ledgerDatabaseFile(root), migrations: [] });
    const foreign = legacyRecord({ id: 'artifact-from-elsewhere', runtimeId: 'sibling', createdAt: 5_000, updatedAt: 5_000 });
    db.prepare(`
      INSERT INTO agent_artifacts(id, runtime_id, agent_kind, source, kind, status, session_id, external_session_id, run_id, tool_call_id, created_at, updated_at, artifact_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(foreign.id, foreign.runtimeId, foreign.agentKind, foreign.source, foreign.kind, foreign.status, null, null, null, null, foreign.createdAt, foreign.updatedAt, JSON.stringify(foreign));

    expect(listAgentArtifacts({ runtimeId: 'sibling' })).toEqual([expect.objectContaining({ id: 'artifact-from-elsewhere', path: '/tmp/legacy/artifact-from-elsewhere.md' })]);
    expect(listAgentArtifacts()).toHaveLength(2);
  });

  it('imports legacy per-process shard files once and renames dead owners to *.migrated', () => {
    const dead = deadPid();
    const self = { pid: process.pid, startTs: Math.round(performance.timeOrigin) };
    // The same artifact in both shards: the later update wins regardless of file order.
    const deadShard = writeLegacyShard(dead, 1, [
      legacyRecord({ id: 'shared', title: 'from dead process', updatedAt: 2_000 }),
      legacyRecord({ id: 'only-dead', createdAt: 900, updatedAt: 900 }),
      { ...legacyRecord({ id: 'bad-schema' }), schemaVersion: 2 as unknown as 1 },
    ]);
    const liveShard = writeLegacyShard(self.pid, self.startTs, [
      legacyRecord({ id: 'shared', title: 'from live process', updatedAt: 1_500 }),
      legacyRecord({ id: 'only-live', createdAt: 950, updatedAt: 950 }),
    ]);
    fs.appendFileSync(liveShard, '{"version":1,"type":"artifact_upsert","ts":1,"rec', 'utf-8');

    const imported = listAgentArtifacts({ runtimeId: 'legacy-runtime' });
    expect(imported.map((record) => record.id)).toEqual(['shared', 'only-live', 'only-dead']);
    expect(imported[0]).toEqual(expect.objectContaining({ title: 'from dead process', createdAt: 1_000, updatedAt: 2_000 }));
    expect(fs.existsSync(`${deadShard}.migrated`)).toBe(true);
    expect(fs.existsSync(deadShard)).toBe(false);
    // A live owner may still be appending during an upgrade window: its shard stays.
    expect(fs.existsSync(liveShard)).toBe(true);

    // Later writes and reloads do not resurrect or duplicate imported rows.
    fileArtifact(0);
    resetAgentArtifactsForTest();
    reloadAgentArtifactsFromDiskForTest();
    expect(listAgentArtifacts({ runtimeId: 'legacy-runtime' }).map((record) => record.id)).toEqual(['shared', 'only-live', 'only-dead']);
    expect(listAgentArtifacts()).toHaveLength(4);
  });

  it('keeps only the newest 1000 artifacts by creation time', () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    for (let index = 0; index < 1_050; index += 1) {
      vi.setSystemTime(10_000 + index);
      ids.push(fileArtifact(index)!.id);
    }
    const kept = listAgentArtifacts({ limit: 1000 });
    expect(kept).toHaveLength(1000);
    const keptIds = new Set(kept.map((record) => record.id));
    for (const id of ids.slice(0, 50)) expect(keptIds.has(id)).toBe(false);
    for (const id of ids.slice(50)) expect(keptIds.has(id)).toBe(true);
    expect(listAgentArtifacts({ limit: 5000 })).toHaveLength(1000);
  });

  it('does not create the database for reads against an untouched mind root', () => {
    expect(listAgentArtifacts()).toEqual([]);
    expect(listAgentArtifacts({ runId: 'run-1' })).toEqual([]);
    expect(fs.existsSync(path.join(root, '.mindos', 'db'))).toBe(false);
  });

  it('drops inputs without a runtime id or pointer and never throws on persistence failures', () => {
    expect(appendAgentArtifact({ runtimeId: '   ', source: 'manual', path: '/tmp/x' })).toBeUndefined();
    expect(appendAgentArtifact({ runtimeId: 'codex', source: 'manual' })).toBeUndefined();
    expect(appendAgentArtifact({ runtimeId: 'codex', source: 'manual', uri: 'data:image/png;base64,AAAA' })).toBeUndefined();
    const db = openMindosDatabase({ file: ledgerDatabaseFile(root), migrations: [] });
    vi.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() => fileArtifact(0)).not.toThrow();
    expect(listAgentArtifacts()).toEqual([]);
  });
});
