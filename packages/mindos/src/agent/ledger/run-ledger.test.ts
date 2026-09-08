import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { openMindosDatabase } from '../../foundation/storage/sqlite.js';
import { readStudioAutomationState } from '../../server/automations/store.js';
import { runWithAgentRunContext } from '../agent-run-context.js';
import { LEDGER_DB_RELATIVE_PATH } from './run-ledger-db.js';
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

function ledgerDbFile(): string {
  return path.join(fs.realpathSync(root), ...LEDGER_DB_RELATIVE_PATH.split('/'));
}

type RawRunRow = { id: string; status: string; owner_pid: number | null; owner_start_ts: number | null; run_json: string };

/** Raw rows as stored, bypassing the read-time orphan projection. */
function rawRunRows(): RawRunRow[] {
  const db = openMindosDatabase({ file: ledgerDbFile(), migrations: [] });
  return db.prepare('SELECT id, status, owner_pid, owner_start_ts, run_json FROM agent_runs ORDER BY started_at DESC, rowid DESC').all() as RawRunRow[];
}

function legacyFileNames(): string[] {
  return fs.existsSync(ledgerDir())
    ? fs.readdirSync(ledgerDir()).filter((name) => name.startsWith('agent-run-ledger.'))
    : [];
}

function makeRecord(overrides: Partial<AgentRunRecord> & { id: string }): AgentRunRecord {
  return {
    rootRunId: overrides.id,
    agentKind: 'acp',
    runtimeId: 'foreign-proc',
    displayName: 'Foreign Process Run',
    status: 'completed',
    permissionMode: 'read',
    inputSummary: 'foreign input',
    startedAt: 100,
    completedAt: 110,
    durationMs: 10,
    ...overrides,
  };
}

/** A legacy v3 shard as written by a pre-sqlite MindOS process. */
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
      permissionMode: 'read',
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
    expect(readStudioAutomationState(root).events[0]).toMatchObject({
      source: 'agent',
      key: run.id,
      type: 'agent.run.completed',
      payload: expect.objectContaining({ runtimeId: 'reviewer', status: 'completed' }),
    });
  });

  it('records failed runs and keeps terminal state stable', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini',
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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

  it('keeps the newest 1000 timeline events newest-first after a 3000-event flood', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'ask',
      inputSummary: 'flood',
    });
    for (let index = 0; index < 3000; index += 1) {
      appendAgentRunEvent(run.id, { type: 'tool_updated', category: 'tool', message: `evt-${index}` });
    }

    const events = listAgentEvents({ runId: run.id, limit: 1000 });
    expect(events).toHaveLength(1000);
    expect(events[0]?.message).toBe('evt-2999');
    expect(events[999]?.message).toBe('evt-2000');
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index - 1]!.ts).toBeGreaterThanOrEqual(events[index]!.ts);
    }
    expect(listAgentEvents({ runId: run.id, limit: 3 }).map((event) => event.message)).toEqual(['evt-2999', 'evt-2998', 'evt-2997']);
    expect(listAgentEvents({ runId: run.id, type: 'run_started' })).toEqual([]);
  });

  it('does not evict another run\'s permission request under a flood of debug text deltas', () => {
    const waiting = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Waiting for approval',
      chatSessionId: 'chat-waiting',
      permissionMode: 'ask',
      inputSummary: 'needs approval',
    });
    appendAgentRunEvent(waiting.id, {
      type: 'permission_requested',
      category: 'permission',
      data: { kind: 'permission', action: 'Bash', status: 'requested', resource: 'rm note.md', prompt: 'Allow delete?' },
    });
    const noisy = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Noisy',
      chatSessionId: 'chat-noisy',
      permissionMode: 'ask',
      inputSummary: 'stream a lot',
    });
    for (let index = 0; index < 3000; index += 1) {
      appendAgentRunEvent(noisy.id, {
        type: 'text',
        category: 'text',
        message: `delta-${index}`,
        data: { kind: 'text', text: `delta-${index}`, channel: 'assistant' },
        visibility: 'debug',
      });
    }

    expect(listAgentEvents({ runId: waiting.id, type: 'permission_requested' })).toHaveLength(1);
    expect(listAgentEvents({ chatSessionId: 'chat-waiting' }).map((event) => event.type)).toEqual(['permission_requested', 'run_started']);
    // Debug deltas stay listable (reattach replays them) and newest-first.
    expect(listAgentEvents({ runId: noisy.id, category: 'text', limit: 3 }).map((event) => event.message))
      .toEqual(['delta-2999', 'delta-2998', 'delta-2997']);
    // A merged listing across timeline and debug events is still newest-first.
    const merged = listAgentEvents({ limit: 1000 });
    expect(merged).toHaveLength(1000);
    for (let index = 1; index < merged.length; index += 1) {
      expect(merged[index - 1]!.ts).toBeGreaterThanOrEqual(merged[index]!.ts);
    }
    expect(merged[0]?.message).toBe('delta-2999');
    // The noisy run's own timeline (run_started) survives its debug flood.
    expect(listAgentEvents({ runId: noisy.id, visibility: 'timeline' }).map((event) => event.type)).toEqual(['run_started']);
  });

  it('filters events by visibility so the observatory projection excludes debug deltas', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'ask',
      inputSummary: 'visibility',
    });
    appendAgentRunEvent(run.id, { type: 'text', category: 'text', message: 'delta', visibility: 'debug' });
    appendAgentRunEvent(run.id, { type: 'tool_started', category: 'tool', message: 'Read' });

    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual(['tool_started', 'text', 'run_started']);
    expect(listAgentEvents({ runId: run.id, visibility: 'timeline' }).map((event) => event.type)).toEqual(['tool_started', 'run_started']);
    expect(listAgentEvents({ runId: run.id, visibility: 'debug' }).map((event) => event.message)).toEqual(['delta']);
  });

  it('resolves the ledger root once per cache window while streaming events, yet honors a resolver change immediately', () => {
    let resolves = 0;
    setMindRootResolverForTests(() => {
      resolves += 1;
      return root;
    });
    resetAgentRunsForTest();
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'ask',
      inputSummary: 'stream',
    });
    const before = resolves;
    for (let index = 0; index < 200; index += 1) {
      appendAgentRunEvent(run.id, { type: 'text', category: 'text', message: `delta-${index}`, visibility: 'debug' });
    }
    expect(resolves - before).toBe(0);
    expect(listAgentEvents({ runId: run.id, limit: 1 }).map((event) => event.message)).toEqual(['delta-199']);

    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ledger-other-'));
    try {
      setMindRootResolverForTests(() => otherRoot);
      expect(listAgentRuns({ runId: run.id })).toEqual([]);
      // Reads against an untouched root do not create a database there.
      expect(fs.existsSync(path.join(otherRoot, '.mindos'))).toBe(false);
      setMindRootResolverForTests(() => root);
      expect(listAgentRuns({ runId: run.id }).map((record) => record.id)).toEqual([run.id]);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('inherits root, chat session, and parent run context when explicit fields are absent', () => {
    const rootRun = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      chatSessionId: 'chat-1',
      permissionMode: 'ask',
      inputSummary: 'Root turn',
    });
    const run = runWithAgentRunContext({ chatSessionId: 'chat-1', rootRunId: rootRun.id, parentRunId: rootRun.id }, () => startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      permissionMode: 'read',
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

  it('does not create the database for reads or resets against an untouched mind root', () => {
    expect(listAgentRuns()).toEqual([]);
    expect(getAgentRun('agent-run-missing')).toBeUndefined();
    expect(listAgentEvents()).toEqual([]);
    expect(appendAgentRunEvent('agent-run-missing', { type: 'text', category: 'text', message: 'x' })).toBeUndefined();
    expect(updateAgentRun('agent-run-missing', { displayName: 'x' })).toBeUndefined();
    expect(completeAgentRun('agent-run-missing')).toBeUndefined();
    resetAgentRunsForTest();
    expect(fs.existsSync(ledgerDir())).toBe(false);
  });

  it('persists run records and timeline events in the sqlite ledger and writes no legacy files', () => {
    const run = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini CLI',
      permissionMode: 'ask',
      inputSummary: 'persist this run',
    });
    appendAgentRunEvent(run.id, { type: 'tool_started', category: 'tool', message: 'Read' });
    completeAgentRun(run.id, { outputSummary: 'persisted output' });

    expect(fs.existsSync(ledgerDbFile())).toBe(true);
    expect(legacyFileNames()).toEqual([]);
    expect(rawRunRows()).toEqual([
      expect.objectContaining({
        id: run.id,
        status: 'completed',
        owner_pid: process.pid,
        owner_start_ts: Math.round(performance.timeOrigin),
      }),
    ]);
    expect(JSON.parse(rawRunRows()[0]!.run_json)).toMatchObject({ id: run.id, outputSummary: 'persisted output' });

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: run.id })).toEqual([
      expect.objectContaining({
        id: run.id,
        status: 'completed',
        outputSummary: 'persisted output',
      }),
    ]);
    // Events survive a restart now (they used to live in memory only).
    expect(listAgentEvents({ runId: run.id }).map((event) => event.type)).toEqual([
      'run_completed',
      'tool_started',
      'run_started',
    ]);
  });

  it('redacts secrets before storing run summaries, metadata, and the persisted row', () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      permissionMode: 'ask',
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

    const stored = rawRunRows().map((row) => row.run_json).join('\n');
    expect(stored).not.toContain('sk-ledger-secret');
    expect(stored).not.toContain('abc123secret');
    expect(stored).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(stored).toContain('[redacted]');
  });

  it('imports the legacy v1 JSON ledger once and preserves it byte-identical as *.migrated', () => {
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

    // The legacy file is a read-only migration source: renamed, never rewritten.
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(fs.readFileSync(`${legacyPath}.migrated`, 'utf-8')).toBe(legacyRaw);
    expect(legacyFileNames()).toEqual(['agent-run-ledger.json.migrated']);

    // A second open does not import the migrated copy again.
    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: record.id })).toHaveLength(1);
    expect(listAgentEvents({ runId: record.id })).toHaveLength(1);
  });

  it('imports the legacy v2 JSONL ledger, replaying its op order, and renames it to *.migrated', () => {
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
    expect(fs.existsSync(legacyLogPath)).toBe(false);
    expect(fs.readFileSync(`${legacyLogPath}.migrated`, 'utf-8')).toBe(legacyRaw);
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
    // Projection only: the stored row still says running.
    expect(rawRunRows().find((row) => row.id === stale.id)?.status).toBe('running');
  });

  it('keeps hundreds of completed runs queryable across a reload without any compaction step', () => {
    const largeSummary = 'x'.repeat(4000);

    for (let index = 0; index < 260; index += 1) {
      const run = startAgentRun({
        agentKind: 'pi-subagent',
        runtimeId: `reviewer-${index}`,
        displayName: `Reviewer ${index}`,
        permissionMode: 'read',
        inputSummary: `${index}:${largeSummary}`,
      });
      completeAgentRun(run.id, { outputSummary: `done:${index}:${largeSummary}` });
    }

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

  it('drops the oldest runs and their events once more than 500 runs exist', () => {
    for (let index = 0; index < 505; index += 1) {
      const run = startAgentRun({
        agentKind: 'pi-subagent',
        runtimeId: `bulk-${index}`,
        displayName: `Bulk ${index}`,
        permissionMode: 'read',
        inputSummary: `bulk ${index}`,
      });
      completeAgentRun(run.id);
    }
    const runs = listAgentRuns({ limit: 500 });
    expect(runs).toHaveLength(500);
    expect(runs[0]?.runtimeId).toBe('bulk-504');
    expect(runs[499]?.runtimeId).toBe('bulk-5');
    expect(rawRunRows()).toHaveLength(500);
    const orphanEvents = openMindosDatabase({ file: ledgerDbFile(), migrations: [] })
      .prepare('SELECT count(*) AS n FROM agent_run_events WHERE run_id NOT IN (SELECT id FROM agent_runs)')
      .get() as { n: number };
    expect(Number(orphanEvents.n)).toBe(0);
  });

  it('imports a dead process\'s shard without altering its bytes and keeps the local run intact', () => {
    const mine = startAgentRun({
      agentKind: 'acp',
      runtimeId: 'local-proc',
      displayName: 'Local Process Run',
      permissionMode: 'read',
      inputSummary: 'local input',
    });
    completeAgentRun(mine.id, { outputSummary: 'local output' });

    // Another (pre-sqlite) MindOS process left its shard behind.
    const foreignFile = writeForeignShard(deadPid(), 1700000000000, [
      makeRecord({ id: 'agent-run-foreign', outputSummary: 'foreign output' }),
    ]);
    const foreignRawBefore = fs.readFileSync(foreignFile, 'utf-8');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-foreign' })).toEqual([
      expect.objectContaining({ id: 'agent-run-foreign', outputSummary: 'foreign output' }),
    ]);
    expect(listAgentRuns({ runId: mine.id })).toEqual([
      expect.objectContaining({ id: mine.id, outputSummary: 'local output' }),
    ]);
    expect(fs.existsSync(foreignFile)).toBe(false);
    expect(fs.readFileSync(`${foreignFile}.migrated`, 'utf-8')).toBe(foreignRawBefore);
  });

  it('marks non-terminal runs from dead processes as failed without touching their stored row', () => {
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
    // Orphan marking is a read-time view, not a rewrite of the evidence.
    expect(rawRunRows().find((row) => row.id === 'agent-run-orphan')?.status).toBe('running');
    expect(fs.readFileSync(`${foreignFile}.migrated`, 'utf-8')).toBe(rawBefore);
  });

  it('keeps non-terminal runs from live processes running and leaves their shard in place', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      const liveFile = writeForeignShard(child.pid!, 1700000000000, [
        makeRecord({ id: 'agent-run-live', status: 'running', completedAt: undefined, durationMs: undefined }),
      ]);

      reloadAgentRunsFromDiskForTest();
      expect(listAgentRuns({ runId: 'agent-run-live' })).toEqual([
        expect.objectContaining({ id: 'agent-run-live', status: 'running' }),
      ]);
      // The owner may still be appending during an upgrade window, so its
      // shard is imported but not renamed until it exits.
      expect(fs.existsSync(liveFile)).toBe(true);
      expect(fs.existsSync(`${liveFile}.migrated`)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('treats a recycled own pid (different process start time) as a dead writer', () => {
    // Same pid as this process, but a start timestamp that is not ours: a
    // previous incarnation of a recycled pid. process.kill(pid, 0) would say
    // "alive", so the start timestamp must disambiguate.
    const file = writeForeignShard(process.pid, Math.round(performance.timeOrigin) - 12345, [
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
    expect(fs.existsSync(`${file}.migrated`)).toBe(true);
  });

  it('resolves cross-source id collisions last-write-wins and warns once', () => {
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

  it('survives a torn trailing line in a legacy shard being imported', () => {
    const file = writeForeignShard(deadPid(), 1700000000000, [
      makeRecord({ id: 'agent-run-torn', outputSummary: 'survived' }),
    ]);
    fs.appendFileSync(file, '{"version":3,"type":"record_upsert","ts":12', 'utf-8');

    reloadAgentRunsFromDiskForTest();
    expect(listAgentRuns({ runId: 'agent-run-torn' })).toEqual([
      expect.objectContaining({ id: 'agent-run-torn', status: 'completed', outputSummary: 'survived' }),
    ]);
  });
});
