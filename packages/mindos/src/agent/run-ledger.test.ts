import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../foundation/mind-root/index.js';
import { runWithAgentRunContext } from './agent-run-context.js';
import {
  appendAgentRunEvent,
  cancelAgentRun,
  completeAgentRun,
  failAgentRun,
  getAgentRun,
  listAgentEvents,
  listAgentRuns,
  reloadAgentRunsFromDiskForTest,
  resetAgentRunsForTest,
  startAgentRun,
  subscribeAgentRunEvents,
  updateAgentRun,
  type AgentRunRecord,
} from './run-ledger.js';

let root = '';

function ledgerDir(): string {
  return path.join(root, '.mindos');
}

/** The shard file THIS process owns — same identity derivation as the ledger. */
function ownShardFile(): string {
  return path.join(ledgerDir(), `agent-run-ledger.${process.pid}-${Math.round(performance.timeOrigin)}.jsonl`);
}

function readOps(file: string): Array<Record<string, unknown>> {
  return fs.readFileSync(file, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function makeRecord(overrides: Partial<AgentRunRecord> & { id: string }): AgentRunRecord {
  return {
    rootRunId: overrides.id,
    agentKind: 'acp',
    runtimeId: 'foreign-proc',
    displayName: 'Foreign Process Run',
    status: 'completed',
    permissionMode: 'readonly',
    inputSummary: 'foreign input',
    startedAt: 100,
    completedAt: 110,
    durationMs: 10,
    ...overrides,
  };
}

function writeForeignShard(pid: number, startTs: number, records: AgentRunRecord[]): string {
  fs.mkdirSync(ledgerDir(), { recursive: true });
  const file = path.join(ledgerDir(), `agent-run-ledger.${pid}-${startTs}.jsonl`);
  const lines = records.map((record) =>
    JSON.stringify({ version: 3, type: 'record_upsert', ts: record.completedAt ?? record.startedAt, record }),
  );
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');
  return file;
}

/** A pid that is guaranteed dead: a child that already ran to completion. */
function deadPid(): number {
  const result = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  if (typeof result.pid !== 'number') throw new Error('failed to spawn probe child');
  return result.pid;
}

describe('agent run ledger', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ledger-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    reloadAgentRunsFromDiskForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records a complete delegation run with duration and query filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const run = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      cwd: '/tmp/project',
      permissionMode: 'readonly',
      inputSummary: 'Review the patch.',
    });

    expect(run.status).toBe('running');
    expect(run.startedAt).toBe(1000);

    vi.setSystemTime(1250);
    const completed = completeAgentRun(run.id, { outputSummary: 'No blocking issues.' });
    expect(completed).toMatchObject({
      id: run.id,
      status: 'completed',
      outputSummary: 'No blocking issues.',
      completedAt: 1250,
      durationMs: 250,
    });

    expect(listAgentRuns({ kind: 'pi-subagent' })).toHaveLength(1);
    expect(listAgentRuns({ status: 'completed' })).toHaveLength(1);
    expect(listAgentRuns({ kind: 'acp' })).toHaveLength(0);
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_completed',
      'run_started',
    ]);
  });

  it('records failed runs and keeps terminal state stable', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini',
      permissionMode: 'agent',
      inputSummary: 'Research this topic.',
    });

    const failed = failAgentRun(run.id, { error: new Error('spawn failed') });
    expect(failed).toMatchObject({
      status: 'failed',
      error: 'spawn failed',
    });

    completeAgentRun(run.id, { outputSummary: 'late success' });
    expect(getAgentRun(run.id)).toMatchObject({
      status: 'failed',
      error: 'spawn failed',
    });
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_failed',
      'run_started',
    ]);
  });

  it('records canceled runs as first-class canceled events', () => {
    const run = startAgentRun({
      agentKind: 'a2a',
      runtimeId: 'remote-agent',
      displayName: 'Remote Agent',
      permissionMode: 'agent',
      inputSummary: 'Delegate this task.',
    });

    const canceled = cancelAgentRun(run.id, {
      reason: 'User stopped the run.',
      metadata: { aborted: true },
    });

    expect(canceled).toMatchObject({
      status: 'canceled',
      error: 'User stopped the run.',
      metadata: { aborted: true },
    });
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_canceled',
      'run_started',
    ]);
    expect(listAgentEvents({ runId: run.id, type: 'run_canceled' })).toEqual([
      expect.objectContaining({
        status: 'canceled',
        message: 'User stopped the run.',
      }),
    ]);
  });

  it('updates runtime metadata after a placeholder run starts', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'missing-agent',
      displayName: 'missing-agent',
      permissionMode: 'agent',
      inputSummary: 'hello',
    });

    updateAgentRun(run.id, {
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      metadata: { sessionId: 'session-1' },
    });

    expect(getAgentRun(run.id)).toMatchObject({
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      metadata: { sessionId: 'session-1' },
    });
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_updated',
      'run_started',
    ]);
  });

  it('stores and merges the archive pointer into the runtime-owned transcript', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      permissionMode: 'agent',
      inputSummary: 'archive me',
      archive: { sessionId: 'claude-session-1' },
    });
    expect(run.archive).toEqual({ sessionId: 'claude-session-1' });

    updateAgentRun(run.id, { archive: { path: '/home/user/.claude/projects/x/claude-session-1.jsonl' } });
    expect(getAgentRun(run.id)?.archive).toEqual({
      sessionId: 'claude-session-1',
      path: '/home/user/.claude/projects/x/claude-session-1.jsonl',
    });

    // The pointer is part of the persisted index card.
    reloadAgentRunsFromDiskForTest();
    expect(getAgentRun(run.id)?.archive).toEqual({
      sessionId: 'claude-session-1',
      path: '/home/user/.claude/projects/x/claude-session-1.jsonl',
    });

    // Empty/blank refs are dropped rather than stored as empty objects.
    const bare = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'agent',
      inputSummary: 'no archive',
      archive: { sessionId: '   ' },
    });
    expect(bare.archive).toBeUndefined();
  });

  it('attaches the archive pointer on terminal writes (the route learns the session id late)', () => {
    const completed = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      permissionMode: 'agent',
      inputSummary: 'late archive on complete',
    });
    completeAgentRun(completed.id, {
      outputSummary: 'done',
      archive: { sessionId: 'claude-session-late' },
    });
    expect(getAgentRun(completed.id)?.archive).toEqual({ sessionId: 'claude-session-late' });

    const failed = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'agent',
      inputSummary: 'late archive on fail',
      archive: { sessionId: 'codex-thread-1' },
    });
    failAgentRun(failed.id, {
      error: 'runtime exploded',
      archive: { path: '/home/user/.codex/sessions/codex-thread-1.jsonl' },
    });
    // Terminal archive patches merge with what the run already knew.
    expect(getAgentRun(failed.id)?.archive).toEqual({
      sessionId: 'codex-thread-1',
      path: '/home/user/.codex/sessions/codex-thread-1.jsonl',
    });

    // Both pointers survive on the persisted index card.
    reloadAgentRunsFromDiskForTest();
    expect(getAgentRun(completed.id)?.archive).toEqual({ sessionId: 'claude-session-late' });
    expect(getAgentRun(failed.id)?.archive).toEqual({
      sessionId: 'codex-thread-1',
      path: '/home/user/.codex/sessions/codex-thread-1.jsonl',
    });
  });

  it('notifies realtime subscribers without letting observer failures affect the ledger', () => {
    const observed: string[] = [];
    const unsubscribeThrowing = subscribeAgentRunEvents(() => {
      throw new Error('observer failed');
    });
    const unsubscribe = subscribeAgentRunEvents((event) => {
      observed.push(`${event.type}:${event.status}`);
    });

    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'agent',
      inputSummary: 'Use Codex',
    });
    completeAgentRun(run.id, { outputSummary: 'Done.' });

    unsubscribeThrowing();
    unsubscribe();

    expect(observed).toEqual([
      'run_started:running',
      'run_completed:completed',
    ]);
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_completed',
      'run_started',
    ]);
  });

  it('records fine-grained timeline events with typed data and category filters', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      chatSessionId: 'chat-events',
      permissionMode: 'agent',
      inputSummary: 'Use Claude',
    });

    appendAgentRunEvent(run.id, {
      type: 'text',
      category: 'text',
      data: { kind: 'text', channel: 'assistant', text: 'I will inspect the files.' },
    });
    appendAgentRunEvent(run.id, {
      type: 'tool_started',
      category: 'tool',
      message: 'Reading package metadata',
      data: { kind: 'tool', name: 'Read', status: 'started', inputSummary: 'package.json' },
    });
    appendAgentRunEvent(run.id, {
      type: 'file_changed',
      category: 'file',
      data: { kind: 'file', action: 'updated', path: 'wiki/specs/runtime.md', summary: 'Updated runtime spec' },
    });
    appendAgentRunEvent(run.id, {
      type: 'permission_requested',
      category: 'permission',
      data: { kind: 'permission', action: 'Bash', status: 'requested', resource: 'rm note.md', prompt: 'Allow delete?' },
    });
    appendAgentRunEvent(run.id, {
      type: 'error',
      category: 'error',
      data: { kind: 'error', message: 'Authorization: Bearer sk-ledger-event-secret-1234567890' },
    });
    updateAgentRun(run.id, { status: 'streaming', outputSummary: 'streaming output' });

    expect(listAgentEvents({ runId: run.id, category: 'text' })).toEqual([
      expect.objectContaining({
        category: 'text',
        data: { kind: 'text', channel: 'assistant', text: 'I will inspect the files.' },
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'tool' })).toEqual([
      expect.objectContaining({
        type: 'tool_started',
        data: expect.objectContaining({ kind: 'tool', name: 'Read', status: 'started' }),
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'file' })).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'file', path: 'wiki/specs/runtime.md', action: 'updated' }),
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'permission' })).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'permission', action: 'Bash', status: 'requested' }),
      }),
    ]);
    expect(listAgentEvents({ runId: run.id, category: 'error' })[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({ kind: 'error', message: 'Authorization: Bearer [redacted]' }),
    }));
    expect(listAgentEvents({ runId: run.id, category: 'status' })[0]).toEqual(expect.objectContaining({
      type: 'run_updated',
      data: expect.objectContaining({ kind: 'status', nextStatus: 'streaming', summary: 'streaming output' }),
    }));
  });

  it('inherits root, chat session, and parent run context when explicit fields are absent', () => {
    const rootRun = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      chatSessionId: 'chat-1',
      permissionMode: 'agent',
      inputSummary: 'Root turn',
    });
    const run = runWithAgentRunContext({ chatSessionId: 'chat-1', rootRunId: rootRun.id, parentRunId: rootRun.id }, () => startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      permissionMode: 'readonly',
      inputSummary: 'Review this patch.',
    }));

    expect(run).toMatchObject({
      rootRunId: rootRun.id,
      chatSessionId: 'chat-1',
      parentRunId: rootRun.id,
    });
    expect(rootRun.rootRunId).toBe(rootRun.id);
    expect(listAgentRuns({ rootRunId: rootRun.id }).map((record) => record.id)).toEqual([
      run.id,
      rootRun.id,
    ]);
    expect(listAgentRuns({ chatSessionId: 'chat-1' })).toEqual([
      expect.objectContaining({ id: run.id }),
      expect.objectContaining({ id: rootRun.id }),
    ]);
    expect(listAgentEvents({ rootRunId: rootRun.id }).map((event) => event.runId)).toEqual([
      run.id,
      rootRun.id,
    ]);
  });

  it('persists run records to this process\'s own shard; timeline events stay in memory', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      permissionMode: 'agent',
      inputSummary: 'persist this run',
    });
    completeAgentRun(run.id, { outputSummary: 'persisted output' });

    const shard = ownShardFile();
    expect(fs.existsSync(shard)).toBe(true);
    const ops = readOps(shard);
    expect(ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        version: 3,
        type: 'record_upsert',
        record: expect.objectContaining({
          id: run.id,
          status: 'completed',
          outputSummary: 'persisted output',
        }),
      }),
    ]));
    // Index card only: no event ops, and no legacy global files are written.
    expect(ops.every((op) => op.type !== 'event_append')).toBe(true);
    expect(fs.existsSync(path.join(ledgerDir(), 'agent-run-ledger.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(ledgerDir(), 'agent-run-ledger.json'))).toBe(false);

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: run.id })).toEqual([
      expect.objectContaining({
        id: run.id,
        status: 'completed',
        outputSummary: 'persisted output',
      }),
    ]);
    // Timeline events are runtime-archive territory — gone after a restart.
    expect(listAgentEvents({ runId: run.id })).toEqual([]);
  });

  it('redacts secrets before storing run summaries, metadata, and the shard log', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      permissionMode: 'agent',
      inputSummary: 'curl -H "Authorization: Bearer sk-ledger-secret-1234567890" https://example.test?token=abc123',
      metadata: {
        apiKey: 'sk-ledger-secret-abcdefghijkl',
        nested: { authToken: 'token-secret-value' },
      },
    });
    completeAgentRun(run.id, {
      outputSummary: 'token=abc123secret\nDone',
      metadata: {
        headers: { Authorization: 'Bearer ghp_abcdefghijklmnopqrstuvwxyz123456' },
      },
    });

    const record = getAgentRun(run.id);
    expect(record?.inputSummary).toBe('curl -H "Authorization: Bearer [redacted]" https://example.test?token=[redacted]');
    expect(record?.outputSummary).toBe('token=[redacted]\nDone');
    expect(record?.metadata).toEqual({
      apiKey: '[redacted]',
      nested: { authToken: '[redacted]' },
      headers: { Authorization: '[redacted]' },
    });

    const rawShard = fs.readFileSync(ownShardFile(), 'utf-8');
    expect(rawShard).not.toContain('sk-ledger-secret');
    expect(rawShard).not.toContain('abc123secret');
    expect(rawShard).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(rawShard).toContain('[redacted]');
  });

  it('merges the legacy v1 JSON ledger read-only without rewriting it', () => {
    fs.mkdirSync(ledgerDir(), { recursive: true });
    const legacyPath = path.join(ledgerDir(), 'agent-run-ledger.json');

    const record = makeRecord({
      id: 'agent-run-legacy',
      runtimeId: 'legacy-acp',
      displayName: 'Legacy ACP',
      inputSummary: 'legacy input',
      outputSummary: 'legacy output',
      startedAt: 100,
      completedAt: 120,
      durationMs: 20,
    });
    const event = {
      id: 'agent-event-legacy',
      runId: record.id,
      type: 'run_completed',
      ts: 120,
      status: 'completed',
      record,
    };
    const legacyRaw = JSON.stringify({ version: 1, records: [record], events: [event] });
    fs.writeFileSync(legacyPath, legacyRaw, 'utf-8');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: record.id })).toEqual([
      expect.objectContaining({ id: record.id, outputSummary: 'legacy output' }),
    ]);
    expect(listAgentEvents({ runId: record.id }).map((item) => item.type)).toEqual(['run_completed']);

    // Legacy files are a read-only migration source — never compacted or rewritten.
    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe(legacyRaw);
    expect(fs.existsSync(path.join(ledgerDir(), 'agent-run-ledger.jsonl'))).toBe(false);
  });

  it('merges the legacy v2 JSONL ledger read-only, replaying its op order', () => {
    fs.mkdirSync(ledgerDir(), { recursive: true });
    const legacyLogPath = path.join(ledgerDir(), 'agent-run-ledger.jsonl');

    const first = makeRecord({ id: 'agent-run-v2', status: 'running', completedAt: undefined, durationMs: undefined });
    const finished = makeRecord({ id: 'agent-run-v2', outputSummary: 'v2 output' });
    const legacyRaw = [
      JSON.stringify({ version: 2, type: 'record_upsert', record: first }),
      JSON.stringify({ version: 2, type: 'record_upsert', record: finished }),
      '',
    ].join('\n');
    fs.writeFileSync(legacyLogPath, legacyRaw, 'utf-8');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-v2' })).toEqual([
      expect.objectContaining({ id: 'agent-run-v2', status: 'completed', outputSummary: 'v2 output' }),
    ]);
    expect(fs.readFileSync(legacyLogPath, 'utf-8')).toBe(legacyRaw);
  });

  it('marks non-terminal legacy runs as failed because no process owns them anymore', () => {
    fs.mkdirSync(ledgerDir(), { recursive: true });
    const stale = makeRecord({ id: 'agent-run-legacy-stale', status: 'running', completedAt: undefined, durationMs: undefined });
    fs.writeFileSync(
      path.join(ledgerDir(), 'agent-run-ledger.json'),
      JSON.stringify({ version: 1, records: [stale], events: [] }),
      'utf-8',
    );

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: stale.id })).toEqual([
      expect.objectContaining({
        id: stale.id,
        status: 'failed',
        metadata: expect.objectContaining({ failureReason: 'process-died' }),
      }),
    ]);
  });

  it('compacts only this process\'s shard after the size threshold is exceeded', () => {
    const largeSummary = 'x'.repeat(4000);

    for (let index = 0; index < 260; index += 1) {
      const run = startAgentRun({
        agentKind: 'pi-subagent',
        runtimeId: `reviewer-${index}`,
        displayName: `Reviewer ${index}`,
        permissionMode: 'readonly',
        inputSummary: `${index}:${largeSummary}`,
      });
      completeAgentRun(run.id, { outputSummary: `done:${index}:${largeSummary}` });
    }

    const operations = readOps(ownShardFile());
    expect(operations[0]).toEqual(expect.objectContaining({
      version: 3,
      type: 'compact',
    }));
    expect(operations.length).toBeLessThan(260 * 2);

    const beforeReload = listAgentRuns({ kind: 'pi-subagent', limit: 500 });
    expect(beforeReload).toHaveLength(260);
    expect(beforeReload[0]).toEqual(expect.objectContaining({
      runtimeId: 'reviewer-259',
      status: 'completed',
    }));

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ kind: 'pi-subagent', limit: 500 })).toHaveLength(260);
    expect(listAgentRuns({ status: 'completed', limit: 500 })).toHaveLength(260);
  });

  it('never rewrites foreign shards: compaction leaves other processes\' files byte-identical', () => {
    const mine = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'local-proc',
      displayName: 'Local Process Run',
      permissionMode: 'readonly',
      inputSummary: 'local input',
    });
    completeAgentRun(mine.id, { outputSummary: 'local output' });

    // Another MindOS process (e.g. the MCP server) owns its own shard; this
    // process's in-memory store knows nothing about it.
    const foreignFile = writeForeignShard(deadPid(), 1700000000000, [
      makeRecord({ id: 'agent-run-foreign', outputSummary: 'foreign output' }),
    ]);
    const foreignRawBefore = fs.readFileSync(foreignFile, 'utf-8');

    // Force the next own-shard append to cross the compaction threshold.
    const statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({ size: 8 * 1024 * 1024 } as ReturnType<typeof fs.statSync>);
    try {
      const trigger = startAgentRun({
        agentKind: 'acp',
        runtimeId: 'local-proc-2',
        displayName: 'Compaction Trigger Run',
        permissionMode: 'readonly',
        inputSummary: 'trigger input',
      });
      completeAgentRun(trigger.id, { outputSummary: 'trigger output' });
    } finally {
      statSpy.mockRestore();
    }

    expect(readOps(ownShardFile())[0]).toEqual(expect.objectContaining({ version: 3, type: 'compact' }));
    expect(fs.readFileSync(foreignFile, 'utf-8')).toBe(foreignRawBefore);
    // The own-shard compact op must not absorb foreign records.
    const compact = readOps(ownShardFile())[0] as { records: AgentRunRecord[] };
    expect(compact.records.some((record) => record.id === 'agent-run-foreign')).toBe(false);

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-foreign' })).toEqual([
      expect.objectContaining({ id: 'agent-run-foreign', outputSummary: 'foreign output' }),
    ]);
    expect(listAgentRuns({ runId: mine.id })).toEqual([
      expect.objectContaining({ id: mine.id, outputSummary: 'local output' }),
    ]);
  });

  it('marks non-terminal runs from dead processes as failed without touching their shard', () => {
    const foreignFile = writeForeignShard(deadPid(), 1700000000000, [
      makeRecord({ id: 'agent-run-orphan', status: 'running', completedAt: undefined, durationMs: undefined }),
      makeRecord({ id: 'agent-run-dead-done', outputSummary: 'finished before exit' }),
    ]);
    const rawBefore = fs.readFileSync(foreignFile, 'utf-8');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-orphan' })).toEqual([
      expect.objectContaining({
        id: 'agent-run-orphan',
        status: 'failed',
        error: expect.stringContaining('exited'),
        metadata: expect.objectContaining({ failureReason: 'process-died' }),
      }),
    ]);
    // Terminal records from dead processes are kept as-is.
    expect(listAgentRuns({ runId: 'agent-run-dead-done' })).toEqual([
      expect.objectContaining({ id: 'agent-run-dead-done', status: 'completed' }),
    ]);
    // Orphan marking is a read-time view, not a foreign-shard rewrite.
    expect(fs.readFileSync(foreignFile, 'utf-8')).toBe(rawBefore);
  });

  it('keeps non-terminal runs from live processes running', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      writeForeignShard(child.pid!, 1700000000000, [
        makeRecord({ id: 'agent-run-live', status: 'running', completedAt: undefined, durationMs: undefined }),
      ]);

      reloadAgentRunsFromDiskForTest();
      expect(listAgentRuns({ runId: 'agent-run-live' })).toEqual([
        expect.objectContaining({ id: 'agent-run-live', status: 'running' }),
      ]);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('treats a recycled own pid (different process start time) as a dead writer', () => {
    // Same pid as this process, but a start timestamp that is not ours: a
    // previous incarnation of a recycled pid. process.kill(pid, 0) would say
    // "alive", so the start timestamp must disambiguate.
    writeForeignShard(process.pid, Math.round(performance.timeOrigin) - 12345, [
      makeRecord({ id: 'agent-run-recycled', status: 'running', completedAt: undefined, durationMs: undefined }),
    ]);

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-recycled' })).toEqual([
      expect.objectContaining({
        id: 'agent-run-recycled',
        status: 'failed',
        metadata: expect.objectContaining({ failureReason: 'process-died' }),
      }),
    ]);
  });

  it('resolves cross-shard id collisions last-write-wins and warns once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const older = makeRecord({ id: 'agent-run-collision', outputSummary: 'older write', completedAt: 110 });
    const newer = makeRecord({ id: 'agent-run-collision', outputSummary: 'newer write', completedAt: 250 });
    writeForeignShard(deadPid(), 1700000000000, [older]);
    writeForeignShard(deadPid(), 1700000000001, [newer]);

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-collision' })).toEqual([
      expect.objectContaining({ id: 'agent-run-collision', outputSummary: 'newer write' }),
    ]);
    const collisionWarnings = warnSpy.mock.calls.filter((call) => String(call[0]).includes('agent-run-collision'));
    expect(collisionWarnings).toHaveLength(1);

    // Re-reading does not warn again for the same id.
    reloadAgentRunsFromDiskForTest();
    listAgentRuns({ runId: 'agent-run-collision' });
    const afterSecondRead = warnSpy.mock.calls.filter((call) => String(call[0]).includes('agent-run-collision'));
    expect(afterSecondRead).toHaveLength(1);
  });

  it('survives a torn trailing line in its own shard', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      permissionMode: 'agent',
      inputSummary: 'before the crash',
    });
    completeAgentRun(run.id, { outputSummary: 'survived' });
    fs.appendFileSync(ownShardFile(), '{"version":3,"type":"record_upsert","ts":12', 'utf-8');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: run.id })).toEqual([
      expect.objectContaining({ id: run.id, status: 'completed', outputSummary: 'survived' }),
    ]);
  });
});
