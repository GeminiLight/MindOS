import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { closeAllMindosDatabases, openMindosDatabase, type MindosDatabase } from '../../foundation/storage/sqlite.js';
import { ledgerDatabaseFile } from './run-ledger-db.js';
import {
  appendAgentRunDeltaEvent,
  appendAgentRunEvent,
  completeAgentRun,
  listAgentEvents,
  reloadAgentRunsFromDiskForTest,
  resetAgentRunsForTest,
  startAgentRun,
  subscribeAgentRunEvents,
  type AgentEvent,
  type AgentRunRecord,
} from './run-ledger.js';
import { appendSseEventToAgentRun } from './run-timeline-events.js';
import type { MindOSSSEvent } from '../turn/index.js';

/**
 * Write-cost contracts for the run ledger (spec-ledger-write-cost, P1):
 * streaming a run must not read the run row per token, must not embed the
 * run record in every event row, and must coalesce token deltas into a
 * bounded number of rows while in-process subscribers still see every delta.
 */

let root = '';

function ledgerDb(): MindosDatabase {
  // Same resolved path as the ledger itself, so this is the ledger's cached handle.
  return openMindosDatabase({ file: ledgerDatabaseFile(root), migrations: [] });
}

type StatementCounter = { count(prefix: string): number; reset(): void };

/** Counts executions per statement, keyed by the first SQL line, on the ledger's own handle. */
function countStatements(db: MindosDatabase): StatementCounter {
  const counts = new Map<string, number>();
  const original = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    const statement = original(sql);
    const key = sql.trim().replace(/\s+/g, ' ');
    return new Proxy(statement, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function' && (prop === 'run' || prop === 'get' || prop === 'all')) {
          return (...args: unknown[]) => {
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
  });
  return {
    count(prefix) {
      let total = 0;
      for (const [key, value] of counts) {
        if (key.startsWith(prefix)) total += value;
      }
      return total;
    },
    reset() {
      counts.clear();
    },
  };
}

type RawEventRow = { seq: number; type: string; event_json: string };

function rawEventRows(runId: string): RawEventRow[] {
  return ledgerDb()
    .prepare('SELECT seq, type, event_json FROM agent_run_events WHERE run_id = ? ORDER BY seq ASC')
    .all(runId) as unknown as RawEventRow[];
}

function startStreamingRun(id?: string): AgentRunRecord {
  return startAgentRun({
    ...(id ? { id } : {}),
    agentKind: 'native-runtime',
    runtimeId: 'claude',
    displayName: 'Claude Code',
    permissionMode: 'ask',
    inputSummary: 'stream tokens',
  });
}

function assistantText(events: AgentEvent[]): string {
  return [...events]
    .reverse()
    .filter((event) => event.data?.kind === 'text' && event.data.channel !== 'reasoning')
    .map((event) => (event.data as { text: string }).text)
    .join('');
}

function reasoningText(events: AgentEvent[]): string {
  return [...events]
    .reverse()
    .filter((event) => event.data?.kind === 'text' && event.data.channel === 'reasoning')
    .map((event) => (event.data as { text: string }).text)
    .join('');
}

function toolOutput(events: AgentEvent[], toolCallId: string): string {
  return [...events]
    .reverse()
    .filter((event) => event.type === 'tool_updated' && event.toolCallId === toolCallId)
    .map((event) => (event.data as { outputSummary?: string }).outputSummary ?? '')
    .join('');
}

/** A realistic turn: reasoning, prose, one tool call with streamed output, more prose. */
function fixtureFrames(): MindOSSSEvent[] {
  const frames: MindOSSSEvent[] = [];
  for (let index = 0; index < 40; index += 1) frames.push({ type: 'thinking_delta', delta: `think-${index} ` });
  for (let index = 0; index < 300; index += 1) frames.push({ type: 'text_delta', delta: `word-${index} ` });
  frames.push({ type: 'tool_start', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', args: { command: 'ls' } });
  for (let index = 0; index < 25; index += 1) frames.push({ type: 'tool_delta', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', delta: `line ${index}\n` });
  frames.push({ type: 'tool_end', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', output: 'done', isError: false });
  for (let index = 300; index < 700; index += 1) frames.push({ type: 'text_delta', delta: `word-${index} ` });
  return frames;
}

describe('run ledger write cost', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ledger-cost-'));
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

  it('does not read the run row or insert one event row per token while a run is open', () => {
    const run = startStreamingRun();
    const counter = countStatements(ledgerDb());

    for (let index = 0; index < 1000; index += 1) {
      appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: `tok${index} ` });
    }
    expect(counter.count('SELECT id, status, started_at')).toBe(0);
    // ~7 KB of text at a 2 KB flush threshold: a handful of rows, not a thousand.
    expect(counter.count('INSERT INTO agent_run_events')).toBeLessThanOrEqual(5);

    counter.reset();
    completeAgentRun(run.id, { outputSummary: 'done' });
    const events = listAgentEvents({ runId: run.id, limit: 1000 });
    expect(events.filter((event) => event.type === 'text').length).toBeLessThanOrEqual(5);
    expect(assistantText(events)).toBe(Array.from({ length: 1000 }, (_, index) => `tok${index} `).join(''));
  });

  it('stores only the event payload on non-lifecycle rows and keeps a record snapshot on lifecycle rows', () => {
    const run = startStreamingRun();
    appendAgentRunEvent(run.id, { type: 'tool_started', category: 'tool', message: 'Read', toolCallId: 'tool-1' });
    appendAgentRunEvent(run.id, {
      type: 'permission_requested',
      category: 'permission',
      data: { kind: 'permission', action: 'Bash', status: 'requested', prompt: 'Allow?' },
    });
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'hello' });
    completeAgentRun(run.id, { outputSummary: 'done' });

    const rows = rawEventRows(run.id).map((row) => ({ type: row.type, hasRecord: 'record' in JSON.parse(row.event_json) }));
    expect(rows).toEqual([
      { type: 'run_started', hasRecord: true },
      { type: 'tool_started', hasRecord: false },
      { type: 'permission_requested', hasRecord: true },
      { type: 'text', hasRecord: false },
      { type: 'run_completed', hasRecord: true },
    ]);
    const textRow = rawEventRows(run.id).find((row) => row.type === 'text')!;
    expect(textRow.event_json.length).toBeLessThan(400);
  });

  it('hydrates record from the run row and still returns legacy rows that embed it', () => {
    const run = startStreamingRun('run-mixed-shapes');
    appendAgentRunEvent(run.id, { type: 'tool_started', category: 'tool', message: 'Read' });
    // A row written by a pre-spec process: the whole record travels inside event_json.
    const legacySnapshot = { ...run, displayName: 'legacy snapshot' };
    ledgerDb().prepare(`
      INSERT INTO agent_run_events(id, run_id, root_run_id, chat_session_id, ts, type, category, visibility, run_started_at, event_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'agent-event-legacy', run.id, run.id, null, run.startedAt + 1, 'text', 'text', 'debug', run.startedAt,
      JSON.stringify({ id: 'agent-event-legacy', runId: run.id, type: 'text', category: 'text', ts: run.startedAt + 1, status: 'running', message: 'old', data: { kind: 'text', text: 'old' }, record: legacySnapshot }),
    );
    completeAgentRun(run.id, { outputSummary: 'done' });

    const events = listAgentEvents({ runId: run.id });
    expect(events.map((event) => event.type)).toEqual(['run_completed', 'text', 'tool_started', 'run_started']);
    for (const event of events) expect(event.record.id).toBe(run.id);
    expect(events.find((event) => event.id === 'agent-event-legacy')?.record.displayName).toBe('legacy snapshot');
    expect(events.find((event) => event.type === 'tool_started')?.record).toEqual(expect.objectContaining({
      id: run.id,
      displayName: 'Claude Code',
      status: 'completed',
    }));
    expect(events.find((event) => event.type === 'run_started')?.record.status).toBe('running');
  });

  it('coalesces deltas by time, size and channel switches, flushing before the next non-delta row', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const run = startStreamingRun();

    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'Hello, ' });
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'world' });
    expect(rawEventRows(run.id).map((row) => row.type)).toEqual(['run_started']);
    vi.advanceTimersByTime(249);
    expect(rawEventRows(run.id).map((row) => row.type)).toEqual(['run_started']);
    vi.advanceTimersByTime(1);
    let rows = rawEventRows(run.id);
    expect(rows.map((row) => row.type)).toEqual(['run_started', 'text']);
    const merged = JSON.parse(rows[1]!.event_json) as AgentEvent;
    expect(merged.message).toBe('Hello, world');
    expect(merged.data).toEqual({ kind: 'text', text: 'Hello, world', channel: 'assistant' });
    expect(merged.ts).toBe(10_000);
    expect(merged.metadata).toEqual({ coalesced: 2 });

    // Size threshold flushes without waiting for the timer.
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'a'.repeat(1500) });
    expect(rawEventRows(run.id)).toHaveLength(2);
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'b'.repeat(600) });
    rows = rawEventRows(run.id);
    expect(rows).toHaveLength(3);
    expect((JSON.parse(rows[2]!.event_json) as AgentEvent).message).toBe(`${'a'.repeat(1500)}${'b'.repeat(600)}`);

    // Switching channel flushes the open buffer so one row never mixes channels.
    appendSseEventToAgentRun(run.id, { type: 'thinking_delta', delta: 'plan ' });
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'answer ' });
    rows = rawEventRows(run.id);
    expect(rows).toHaveLength(4);
    expect((JSON.parse(rows[3]!.event_json) as AgentEvent).data).toEqual({ kind: 'text', text: 'plan ', channel: 'reasoning' });

    // A non-delta event flushes the pending buffer first so seq follows wall-clock order.
    appendSseEventToAgentRun(run.id, { type: 'tool_start', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', args: {} });
    rows = rawEventRows(run.id);
    expect(rows.map((row) => row.type)).toEqual(['run_started', 'text', 'text', 'text', 'text', 'tool_started']);
    expect((JSON.parse(rows[4]!.event_json) as AgentEvent).data).toEqual({ kind: 'text', text: 'answer ', channel: 'assistant' });
    expect(rows[4]!.seq).toBeLessThan(rows[5]!.seq);

    // Tool output deltas are keyed by toolCallId and land under the tool's own row.
    appendSseEventToAgentRun(run.id, { type: 'tool_delta', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', delta: 'out-1\n' });
    appendSseEventToAgentRun(run.id, { type: 'tool_delta', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', delta: 'out-2\n' });
    completeAgentRun(run.id, { outputSummary: 'done' });
    rows = rawEventRows(run.id);
    expect(rows.map((row) => row.type).slice(-2)).toEqual(['tool_updated', 'run_completed']);
    const toolRow = JSON.parse(rows[rows.length - 2]!.event_json) as AgentEvent;
    expect(toolRow.toolCallId).toBe('tool-1');
    expect(toolRow.data).toEqual({ kind: 'tool', name: 'Bash', status: 'running', outputSummary: 'out-1\nout-2\n' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps delivering every live delta to in-process subscribers with the run record attached', () => {
    vi.useFakeTimers();
    const run = startStreamingRun();
    const seen: AgentEvent[] = [];
    const unsubscribe = subscribeAgentRunEvents((event) => {
      seen.push(event);
    });
    try {
      appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'a' });
      appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'b' });
      appendSseEventToAgentRun(run.id, { type: 'thinking_delta', delta: 'c' });
    } finally {
      unsubscribe();
    }
    expect(seen.map((event) => (event.data as { text: string }).text)).toEqual(['a', 'b', 'c']);
    expect(new Set(seen.map((event) => event.id)).size).toBe(3);
    for (const event of seen) {
      expect(event.record).toEqual(expect.objectContaining({ id: run.id, agentKind: 'native-runtime' }));
      expect(event.visibility).toBe('debug');
    }
    // The subscriber's first delta is untouched by later merges into the persisted row.
    vi.advanceTimersByTime(250);
    expect((seen[0]!.data as { text: string }).text).toBe('a');
  });

  it('replays the same text, reasoning and tool output as per-token rows would', () => {
    const run = startStreamingRun();
    const frames = fixtureFrames();
    for (const frame of frames) appendSseEventToAgentRun(run.id, frame);
    completeAgentRun(run.id, { outputSummary: 'done' });

    const expectedAssistant = frames.filter((frame) => frame.type === 'text_delta').map((frame) => (frame as { delta: string }).delta).join('');
    const expectedReasoning = frames.filter((frame) => frame.type === 'thinking_delta').map((frame) => (frame as { delta: string }).delta).join('');
    const expectedTool = frames.filter((frame) => frame.type === 'tool_delta').map((frame) => (frame as { delta: string }).delta).join('');

    const events = listAgentEvents({ runId: run.id, limit: 1000 });
    expect(assistantText(events)).toBe(expectedAssistant);
    expect(reasoningText(events)).toBe(expectedReasoning);
    expect(toolOutput(events, 'tool-1')).toBe(expectedTool);
    // Timeline-visible events are untouched by coalescing.
    expect(listAgentEvents({ runId: run.id, visibility: 'timeline' }).map((event) => event.type))
      .toEqual(['run_completed', 'tool_completed', 'tool_started', 'run_started']);
    // Order across the tool boundary survives: prose before tool_start, tool output, prose after.
    const ordered = [...events].reverse();
    const toolStartIndex = ordered.findIndex((event) => event.type === 'tool_started');
    const toolEndIndex = ordered.findIndex((event) => event.type === 'tool_completed');
    expect(ordered.slice(0, toolStartIndex).every((event) => event.type === 'run_started' || event.type === 'text')).toBe(true);
    expect(ordered.slice(toolStartIndex + 1, toolEndIndex).every((event) => event.type === 'tool_updated')).toBe(true);
    expect(ordered.slice(toolEndIndex + 1, -1).every((event) => event.type === 'text')).toBe(true);
    expect(events.length).toBeLessThan(frames.length / 10);
  });

  it('flushes pending deltas before an in-process read so reattach replays the current text', () => {
    vi.useFakeTimers();
    const run = startStreamingRun();
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'partial ' });
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'answer' });
    expect(assistantText(listAgentEvents({ runId: run.id }))).toBe('partial answer');
    expect(vi.getTimerCount()).toBe(0);
    // Nothing is written twice once the timer window would have elapsed.
    vi.advanceTimersByTime(250);
    expect(rawEventRows(run.id).filter((row) => row.type === 'text')).toHaveLength(1);
  });

  it('survives the database handle being closed under an open run and flushes into the reopened handle', () => {
    vi.useFakeTimers();
    const run = startStreamingRun();
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'before close ' });
    closeAllMindosDatabases();
    // The pending buffer outlives the handle: the flush reopens and writes it.
    appendSseEventToAgentRun(run.id, { type: 'text_delta', delta: 'after reopen' });
    vi.advanceTimersByTime(250);
    appendAgentRunEvent(run.id, { type: 'tool_started', category: 'tool', message: 'Read' });
    completeAgentRun(run.id, { outputSummary: 'done' });

    const events = listAgentEvents({ runId: run.id });
    expect(events.map((event) => event.type)).toEqual(['run_completed', 'tool_started', 'text', 'run_started']);
    expect(assistantText(events)).toBe('before close after reopen');
    expect(events.every((event) => event.record.id === run.id)).toBe(true);
  });

  it('caches a run this process owns after a reopen instead of reading the row per delta', () => {
    const run = startStreamingRun();
    closeAllMindosDatabases();
    const counter = countStatements(ledgerDb());
    for (let index = 0; index < 50; index += 1) {
      appendAgentRunDeltaEvent(run.id, { type: 'text', category: 'text', message: `t${index}`, visibility: 'debug' });
    }
    // One read to repopulate the cache, then none.
    expect(counter.count('SELECT id, status, started_at')).toBe(1);
    completeAgentRun(run.id, { outputSummary: 'done' });
    expect(assistantText(listAgentEvents({ runId: run.id }))).toBe(Array.from({ length: 50 }, (_, index) => `t${index}`).join(''));
  });

  it('returns nothing for a delta on an unknown run and does not create a buffer', () => {
    vi.useFakeTimers();
    expect(appendAgentRunDeltaEvent('missing-run', { type: 'text', category: 'text', message: 'x' })).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(listAgentEvents({ runId: 'missing-run' })).toEqual([]);
  });
});
