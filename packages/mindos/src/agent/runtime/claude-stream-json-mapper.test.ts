/**
 * Table-driven parity tests for the Claude stream-json mapper
 * (spec-runtime-lane-correctness, item 4). The same fixture records are fed
 * through the CLI transport (JSON lines) and the Claude Agent SDK transport
 * (message objects); both must yield identical MindOS SSE sequences.
 */
import { describe, expect, it } from 'vitest';
import {
  createClaudeCodeCliClient,
  createClaudeCodeSdkClient,
  type ClaudeCodeCliEvent,
  type ClaudeCodeCliTransport,
  type ClaudeCodeSdkModule,
} from './index.js';
import {
  createClaudeStreamJsonMapperState,
  mapClaudeStreamJsonRecordToSseEvents,
} from './claude-stream-json-mapper.js';

function createFakeClaudeTransport(lines: string[]): ClaudeCodeCliTransport {
  return {
    run() {
      return {
        async *[Symbol.asyncIterator]() {
          for (const line of lines) yield line;
        },
      };
    },
  };
}

function createFakeClaudeSdk(messages: Record<string, unknown>[]): ClaudeCodeSdkModule {
  return {
    query() {
      return {
        async *[Symbol.asyncIterator]() {
          for (const message of messages) yield message;
        },
      };
    },
  };
}

async function collect(iterable: AsyncIterable<ClaudeCodeCliEvent>): Promise<ClaudeCodeCliEvent[]> {
  const events: ClaudeCodeCliEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function runThroughCli(records: Record<string, unknown>[]): Promise<ClaudeCodeCliEvent[]> {
  const client = createClaudeCodeCliClient(createFakeClaudeTransport(records.map((record) => JSON.stringify(record))));
  return collect(client.startTurn({ prompt: 'hi', cwd: '/tmp/mind' }));
}

async function runThroughSdk(records: Record<string, unknown>[]): Promise<ClaudeCodeCliEvent[]> {
  const client = createClaudeCodeSdkClient({ sdk: createFakeClaudeSdk(records) });
  return collect(client.startTurn({ prompt: 'hi', cwd: '/tmp/mind' }));
}

const SESSION = 'claude-parity';

type Fixture = {
  name: string;
  records: Record<string, unknown>[];
  expected: ClaudeCodeCliEvent[];
};

const FIXTURES: Fixture[] = [
  {
    name: 'streams text blocks and finishes on a success result without repeating the final text',
    records: [
      { type: 'system', subtype: 'init', session_id: SESSION },
      { type: 'assistant', session_id: SESSION, message: { content: [{ type: 'text', text: 'Hello' }] } },
      { type: 'result', subtype: 'success', session_id: SESSION, result: 'Hello' },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'done' },
    ],
  },
  {
    name: 'emits the result text when no assistant text streamed',
    records: [
      { type: 'result', subtype: 'success', session_id: SESSION, result: 'Final answer' },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'text_delta', delta: 'Final answer' },
      { type: 'done' },
    ],
  },
  {
    name: 'treats a non-success result subtype as an error even without is_error',
    records: [
      { type: 'system', subtype: 'init', session_id: SESSION },
      { type: 'assistant', session_id: SESSION, message: { content: [{ type: 'text', text: 'Working' }] } },
      { type: 'result', subtype: 'error_max_turns', session_id: SESSION, num_turns: 50 },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'text_delta', delta: 'Working' },
      { type: 'error', message: 'Claude Code turn ended with error_max_turns.' },
    ],
  },
  {
    name: 'joins result errors[] into the error message and redacts secrets',
    records: [
      { type: 'result', subtype: 'error_during_execution', session_id: SESSION, is_error: true, errors: ['Rate limit reached', 'api_key=sk-1234567890abcdefghij leaked'] },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'error', message: 'Rate limit reached\napi_key=[redacted] leaked' },
    ],
  },
  {
    name: 'falls back to result text for is_error results',
    records: [
      { type: 'result', subtype: 'error', session_id: SESSION, is_error: true, result: 'Credit balance is too low' },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'error', message: 'Credit balance is too low' },
    ],
  },
  {
    name: 'accepts string message content',
    records: [
      { type: 'assistant', session_id: SESSION, message: { content: 'plain text' } },
      { type: 'result', subtype: 'success', session_id: SESSION, result: 'plain text' },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'text_delta', delta: 'plain text' },
      { type: 'done' },
    ],
  },
  {
    name: 'maps thinking, tool_use and tool_result blocks',
    records: [
      { type: 'assistant', session_id: SESSION, message: { content: [
        { type: 'thinking', thinking: 'consider' },
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
      ] } },
      { type: 'user', session_id: SESSION, message: { content: [
        { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file.md' }], is_error: false },
      ] } },
      { type: 'result', subtype: 'success', session_id: SESSION, result: '' },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'thinking_delta', delta: 'consider' },
      { type: 'tool_start', toolCallId: 'tool-1', toolName: 'Bash', args: { command: 'ls' }, runtime: 'claude' },
      { type: 'tool_end', toolCallId: 'tool-1', output: 'file.md', isError: false, runtime: 'claude' },
      { type: 'done' },
    ],
  },
  {
    name: 'maps system permission_denied with decision_reason',
    records: [
      { type: 'system', subtype: 'permission_denied', session_id: SESSION, tool_use_id: 'tool-2', tool_name: 'Write', decision_reason: 'blocked by policy' },
      { type: 'result', subtype: 'success', session_id: SESSION, result: 'ok' },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'tool_start', toolCallId: 'tool-2', toolName: 'Write', args: { reason: 'blocked by policy' }, runtime: 'claude' },
      { type: 'tool_end', toolCallId: 'tool-2', output: 'blocked by policy', isError: true, runtime: 'claude' },
      { type: 'text_delta', delta: 'ok' },
      { type: 'done' },
    ],
  },
  {
    name: 'maps top-level permission_denied with reason, blockedPath and decisionReason',
    records: [
      { type: 'permission_denied', session_id: SESSION, toolUseID: 'tool-3', toolName: 'Edit', reason: 'outside workspace', blockedPath: '/etc/hosts', decisionReason: 'ignored when reason is present' },
      { type: 'result', subtype: 'success', session_id: SESSION },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'tool_start', toolCallId: 'tool-3', toolName: 'Edit', args: { reason: 'outside workspace', blockedPath: '/etc/hosts' }, runtime: 'claude' },
      { type: 'tool_end', toolCallId: 'tool-3', output: 'outside workspace', isError: true, runtime: 'claude' },
      { type: 'done' },
    ],
  },
  {
    name: 'maps api_retry, status, rate_limit_event and tool_progress into visible runtime status',
    records: [
      { type: 'system', subtype: 'api_retry', session_id: SESSION, attempt: 2, max_retries: 5, retry_delay_ms: 4000, error_status: 529 },
      { type: 'system', subtype: 'status', session_id: SESSION, status: 'compacting' },
      { type: 'system', subtype: 'status', session_id: SESSION, status: 'requesting' },
      { type: 'system', subtype: 'status', session_id: SESSION, status: 'unknown-status' },
      { type: 'rate_limit_event', session_id: SESSION, rate_limit_info: { status: 'rejected' } },
      { type: 'rate_limit_event', session_id: SESSION, rate_limit_info: { status: 'allowed' } },
      { type: 'tool_progress', session_id: SESSION, tool_name: 'Bash', elapsed_time_seconds: 12.4 },
      { type: 'tool_progress', session_id: SESSION },
      { type: 'result', subtype: 'success', session_id: SESSION },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code HTTP 529; retrying (2/5). Retrying in 4s.' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is compacting context.' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is contacting Claude.' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code rate limit is rejected.' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is still running Bash (12s).' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is still running tool.' },
      { type: 'done' },
    ],
  },
  {
    name: 'synthesizes done when the stream ends without a result record',
    records: [
      { type: 'system', subtype: 'init', session_id: SESSION },
      { type: 'assistant', session_id: SESSION, message: { content: [{ type: 'text', text: 'partial' }] } },
    ],
    expected: [
      { type: 'session_id', sessionId: SESSION },
      { type: 'text_delta', delta: 'partial' },
      { type: 'done' },
    ],
  },
];

describe('Claude stream-json mapper parity (CLI transport vs Claude Agent SDK transport)', () => {
  it.each(FIXTURES)('$name', async ({ records, expected }) => {
    const cliEvents = await runThroughCli(records);
    const sdkEvents = await runThroughSdk(records);

    expect(cliEvents).toEqual(expected);
    expect(sdkEvents).toEqual(expected);
    expect(sdkEvents).toEqual(cliEvents);
  });

  it('ignores blank and non-JSON CLI lines without ending the turn', async () => {
    const client = createClaudeCodeCliClient(createFakeClaudeTransport([
      '',
      'not json',
      JSON.stringify({ type: 'assistant', session_id: SESSION, message: { content: [{ type: 'text', text: 'ok' }] } }),
      JSON.stringify(['array', 'ignored']),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: SESSION }),
    ]));
    await expect(collect(client.startTurn({ prompt: 'hi', cwd: '/tmp/mind' }))).resolves.toEqual([
      { type: 'session_id', sessionId: SESSION },
      { type: 'text_delta', delta: 'ok' },
      { type: 'done' },
    ]);
  });
});

describe('mapClaudeStreamJsonRecordToSseEvents', () => {
  it('treats a result without subtype as legacy success and a bare error subtype as failure', () => {
    const legacy = createClaudeStreamJsonMapperState();
    expect(mapClaudeStreamJsonRecordToSseEvents({ type: 'result', result: 'final answer' }, legacy)).toEqual([
      { type: 'text_delta', delta: 'final answer' },
      { type: 'done' },
    ]);
    expect(legacy.emittedDone).toBe(true);

    const failed = createClaudeStreamJsonMapperState();
    expect(mapClaudeStreamJsonRecordToSseEvents({ type: 'result', subtype: 'error' }, failed)).toEqual([
      { type: 'error', message: 'Claude Code turn failed' },
    ]);
    expect(failed.emittedDone).toBe(true);
  });

  it('prefers result text over the subtype fallback for failed results', () => {
    const state = createClaudeStreamJsonMapperState();
    expect(mapClaudeStreamJsonRecordToSseEvents(
      { type: 'result', subtype: 'error_max_turns', result: 'Reached the turn limit' },
      state,
    )).toEqual([{ type: 'error', message: 'Reached the turn limit' }]);
  });

  it('does not repeat streamed text on a success result', () => {
    const state = createClaudeStreamJsonMapperState();
    expect(mapClaudeStreamJsonRecordToSseEvents(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'streamed' }] } },
      state,
    )).toEqual([{ type: 'text_delta', delta: 'streamed' }]);
    expect(mapClaudeStreamJsonRecordToSseEvents(
      { type: 'result', subtype: 'success', result: 'streamed' },
      state,
    )).toEqual([{ type: 'done' }]);
  });

  it('ignores unknown record types and empty content', () => {
    const state = createClaudeStreamJsonMapperState();
    expect(mapClaudeStreamJsonRecordToSseEvents({ type: 'unknown' }, state)).toEqual([]);
    expect(mapClaudeStreamJsonRecordToSseEvents({ type: 'assistant', message: { content: [] } }, state)).toEqual([]);
    expect(mapClaudeStreamJsonRecordToSseEvents({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } }, state)).toEqual([]);
    expect(mapClaudeStreamJsonRecordToSseEvents({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x' }] } }, state)).toEqual([]);
    expect(mapClaudeStreamJsonRecordToSseEvents({ type: 'user', message: { content: [{ type: 'tool_result' }] } }, state)).toEqual([]);
  });
});
