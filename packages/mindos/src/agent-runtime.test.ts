import { describe, expect, it } from 'vitest';
import {
  createClaudeCodeCliClient,
  createCodexAppServerClient,
  mapCodexAppServerNotificationToSseEvents,
  runMindosAgentRuntimeAskSession,
  type CodexAppServerMessage,
  type CodexAppServerTransport,
  type ClaudeCodeCliTransport,
  type MindOSSSEvent,
} from './agent-runtime.js';

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private readers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const reader = this.readers.shift();
    if (reader) {
      reader({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const reader of this.readers.splice(0)) {
      reader({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.readers.push(resolve));
      },
    };
  }
}

function createFakeCodexTransport(): CodexAppServerTransport & { sent: unknown[] } {
  const queue = new AsyncQueue<CodexAppServerMessage>();
  const sent: unknown[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      const record = message as { id?: number; method?: string; params?: Record<string, unknown> };
      if (record.method === 'initialize') {
        queue.push({ id: record.id!, result: { userAgent: 'codex-test' } });
      }
      if (record.method === 'thread/start') {
        queue.push({ id: record.id!, result: { thread: { id: 'thr-new' } } });
      }
      if (record.method === 'thread/resume') {
        queue.push({ id: record.id!, result: { thread: { id: record.params?.threadId } } });
      }
      if (record.method === 'turn/start') {
        queue.push({ id: record.id!, result: { turn: { id: 'turn-1' } } });
        queue.push({ method: 'item/agentMessage/delta', params: { delta: 'Hello' } });
        queue.push({ method: 'turn/completed', params: { turn: { id: 'turn-1' }, status: 'completed' } });
      }
    },
    read() {
      return queue;
    },
    close() {
      queue.close();
    },
  };
}

function createFakeClaudeTransport(lines: string[]): ClaudeCodeCliTransport & { argv: string[] | null } {
  return {
    argv: null,
    run(args) {
      this.argv = args;
      return {
        async *[Symbol.asyncIterator]() {
          for (const line of lines) yield line;
        },
      };
    },
  };
}

describe('agent runtime adapters', () => {
  it('drives Codex app-server over JSON-RPC and streams turn notifications', async () => {
    const transport = createFakeCodexTransport();
    const client = createCodexAppServerClient(transport, {
      clientInfo: { name: 'mindos_test', title: 'MindOS Test', version: '0.0.0' },
    });

    await client.initialize();
    const thread = await client.startThread({ cwd: '/tmp/mind' });
    const notifications = [];
    for await (const notification of client.startTurn({
      threadId: thread.threadId,
      cwd: '/tmp/mind',
      input: [{ type: 'text', text: 'Summarize this repo.' }],
    })) {
      notifications.push(notification);
    }

    expect(transport.sent).toEqual([
      {
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: { name: 'mindos_test', title: 'MindOS Test', version: '0.0.0' },
        },
      },
      { method: 'initialized', params: {} },
      { method: 'thread/start', id: 2, params: {} },
      {
        method: 'turn/start',
        id: 3,
        params: {
          threadId: 'thr-new',
          cwd: '/tmp/mind',
          input: [{ type: 'text', text: 'Summarize this repo.' }],
        },
      },
    ]);
    expect(notifications).toEqual([
      { method: 'item/agentMessage/delta', params: { delta: 'Hello' } },
      { method: 'turn/completed', params: { turn: { id: 'turn-1' }, status: 'completed' } },
    ]);
  });

  it('maps Codex notifications into MindOS SSE events', () => {
    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/agentMessage/delta',
      params: { delta: 'Hello' },
    })).toEqual([{ type: 'text_delta', delta: 'Hello' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/thinking/delta',
      params: { delta: 'Thinking' },
    })).toEqual([{ type: 'thinking_delta', delta: 'Thinking' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'turn/completed',
      params: { status: 'completed' },
    })).toEqual([{ type: 'done' }]);
  });

  it('ends a Codex turn stream after turn/failed', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const sent: unknown[] = [];
    const transport: CodexAppServerTransport = {
      send(message) {
        sent.push(message);
        const record = message as { id?: number; method?: string };
        if (record.method === 'initialize') {
          queue.push({ id: record.id!, result: { userAgent: 'codex-test' } });
        }
        if (record.method === 'thread/start') {
          queue.push({ id: record.id!, result: { thread: { id: 'thr-new' } } });
        }
        if (record.method === 'turn/start') {
          queue.push({ id: record.id!, result: { turn: { id: 'turn-1' } } });
          queue.push({ method: 'turn/failed', params: { message: 'model unavailable' } });
        }
      },
      read() {
        return queue;
      },
      close() {
        queue.close();
      },
    };

    const client = createCodexAppServerClient(transport);
    await client.initialize();
    const thread = await client.startThread({ cwd: '/tmp/mind' });
    const notifications = [];
    for await (const notification of client.startTurn({
      threadId: thread.threadId,
      cwd: '/tmp/mind',
      input: [{ type: 'text', text: 'Summarize this repo.' }],
    })) {
      notifications.push(notification);
    }

    expect(notifications).toEqual([
      { method: 'turn/failed', params: { message: 'model unavailable' } },
    ]);
  });

  it('runs a Codex native Ask session and returns the external thread binding', async () => {
    const events: MindOSSSEvent[] = [];
    const transport = createFakeCodexTransport();
    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Summarize this repo.',
      send: (event) => events.push(event),
      services: {
        createCodexClient: () => createCodexAppServerClient(transport),
      },
    });

    expect(result).toEqual({ externalSessionId: 'thr-new' });
    expect(events).toEqual([
      { type: 'runtime_binding', runtime: 'codex', externalSessionId: 'thr-new', cwd: '/tmp/mind' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('resumes an existing Codex thread when the runtime carries an external session id', async () => {
    const transport = createFakeCodexTransport();
    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex', externalSessionId: 'thr-existing' },
      cwd: '/tmp/mind',
      prompt: 'Continue.',
      send: () => {},
      services: {
        createCodexClient: () => createCodexAppServerClient(transport),
      },
    });

    expect(transport.sent).toContainEqual({
      method: 'thread/resume',
      id: 2,
      params: { threadId: 'thr-existing' },
    });
    expect(transport.sent).not.toContainEqual({
      method: 'thread/start',
      id: 2,
      params: {},
    });
  });

  it('streams Claude Code CLI output and returns the session binding', async () => {
    const events: MindOSSSEvent[] = [];
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-1' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-1' }),
    ]);

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      send: (event) => events.push(event),
      services: {
        createClaudeClient: () => createClaudeCodeCliClient(transport),
      },
    });

    expect(transport.argv).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      'Review this.',
    ]);
    expect(result).toEqual({ externalSessionId: 'claude-session-1' });
    expect(events).toEqual([
      { type: 'runtime_binding', runtime: 'claude', externalSessionId: 'claude-session-1', cwd: '/tmp/mind' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('resumes an existing Claude Code session when the runtime carries an external session id', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-existing' }),
    ]);

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', externalSessionId: 'claude-existing' },
      cwd: '/tmp/mind',
      prompt: 'Continue.',
      send: () => {},
      services: {
        createClaudeClient: () => createClaudeCodeCliClient(transport),
      },
    });

    expect(transport.argv).toContain('--resume');
    expect(transport.argv).toContain('claude-existing');
  });
});
