import { describe, expect, it, vi } from 'vitest';
import {
  createClaudeCodeCliClient,
  createClaudeCodeCliStdioTransport,
  createCodexAppServerClient,
  mapCodexAppServerNotificationToSseEvents,
  runMindosAgentRuntimeAskSession,
  type CodexAppServerMessage,
  type CodexAppServerClient,
  type CodexAppServerTransport,
  type ClaudeCodeCliClient,
  type ClaudeCodeCliTransport,
  type ClaudeCodeSdkModule,
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
      if (record.method === 'thread/list') {
        queue.push({
          id: record.id!,
          result: {
            data: [
              {
                id: 'thr-existing',
                sessionId: 'sess-existing',
                preview: 'Existing Codex thread',
                ephemeral: false,
                modelProvider: 'openai',
                createdAt: 1,
                updatedAt: 2,
                cwd: '/tmp/mind',
                status: { type: 'idle' },
                cliVersion: '0.138.0',
                source: 'appServer',
                turns: [],
              },
            ],
            nextCursor: 'cursor-next',
            backwardsCursor: null,
          },
        });
      }
      if (record.method === 'thread/read') {
        queue.push({
          id: record.id!,
          result: {
            thread: {
              id: record.params?.threadId,
              sessionId: 'sess-existing',
              preview: 'Existing Codex thread',
              ephemeral: false,
              modelProvider: 'openai',
              createdAt: 1,
              updatedAt: 2,
              cwd: '/tmp/mind',
              status: { type: 'idle' },
              cliVersion: '0.138.0',
              source: 'appServer',
              turns: record.params?.includeTurns ? [{ id: 'turn-existing' }] : [],
            },
          },
        });
      }
      if (record.method === 'thread/fork') {
        queue.push({
          id: record.id!,
          result: {
            thread: {
              id: 'thr-forked',
              forkedFromId: record.params?.threadId,
              sessionId: 'sess-forked',
              preview: 'Forked Codex thread',
              ephemeral: Boolean(record.params?.ephemeral),
              modelProvider: 'openai',
              createdAt: 3,
              updatedAt: 4,
              cwd: record.params?.cwd ?? '/tmp/mind',
              status: { type: 'idle' },
              cliVersion: '0.138.0',
              source: 'appServer',
              turns: [],
            },
          },
        });
      }
      if (record.method === 'thread/archive') {
        queue.push({ id: record.id!, result: {} });
      }
      if (record.method === 'thread/unarchive') {
        queue.push({
          id: record.id!,
          result: {
            thread: {
              id: record.params?.threadId,
              sessionId: 'sess-existing',
              preview: 'Existing Codex thread',
              ephemeral: false,
              modelProvider: 'openai',
              createdAt: 1,
              updatedAt: 2,
              cwd: '/tmp/mind',
              status: { type: 'idle' },
              cliVersion: '0.138.0',
              source: 'appServer',
              turns: [],
            },
          },
        });
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

function createFakeClaudeSdk(
  messages: Record<string, unknown>[] | ((params: Parameters<ClaudeCodeSdkModule['query']>[0]) => AsyncIterable<Record<string, unknown>>),
): ClaudeCodeSdkModule & { params: Parameters<ClaudeCodeSdkModule['query']>[0] | null } {
  return {
    params: null,
    query(params) {
      this.params = params;
      if (typeof messages === 'function') return messages(params);
      return {
        async *[Symbol.asyncIterator]() {
          for (const message of messages) yield message;
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
          capabilities: { experimentalApi: true },
        },
      },
      { method: 'initialized', params: {} },
      { method: 'thread/start', id: 2, params: { cwd: '/tmp/mind' } },
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

  it('uses a Codex-compatible default app-server client identity', async () => {
    const transport = createFakeCodexTransport();
    const client = createCodexAppServerClient(transport);

    await client.initialize();

    expect(transport.sent[0]).toEqual({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: { name: 'codex-mindos', title: 'Codex MindOS', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      },
    });
  });

  it('lists and reads Codex threads without starting a turn', async () => {
    const transport = createFakeCodexTransport();
    const client = createCodexAppServerClient(transport);

    await client.initialize();
    const list = await client.listThreads({
      limit: 20,
      archived: false,
      cwd: '/tmp/mind',
      searchTerm: 'Existing',
      useStateDbOnly: true,
    });
    const read = await client.readThread({ threadId: 'thr-existing', includeTurns: true });

    expect(list).toEqual({
      data: [expect.objectContaining({
        id: 'thr-existing',
        sessionId: 'sess-existing',
        preview: 'Existing Codex thread',
      })],
      nextCursor: 'cursor-next',
      backwardsCursor: null,
    });
    expect(read.thread).toMatchObject({
      id: 'thr-existing',
      sessionId: 'sess-existing',
      turns: [{ id: 'turn-existing' }],
    });
    expect(transport.sent).toEqual([
      expect.objectContaining({ method: 'initialize' }),
      { method: 'initialized', params: {} },
      {
        method: 'thread/list',
        id: 2,
        params: {
          limit: 20,
          archived: false,
          cwd: '/tmp/mind',
          searchTerm: 'Existing',
          useStateDbOnly: true,
        },
      },
      {
        method: 'thread/read',
        id: 3,
        params: {
          threadId: 'thr-existing',
          includeTurns: true,
        },
      },
    ]);
    expect(transport.sent).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'turn/start' }),
    ]));
  });

  it('forks, archives, and unarchives Codex threads through app-server thread methods', async () => {
    const transport = createFakeCodexTransport();
    const client = createCodexAppServerClient(transport);

    await client.initialize();
    const fork = await client.forkThread({ threadId: 'thr-existing', cwd: '/tmp/forked', ephemeral: true });
    await client.archiveThread({ threadId: 'thr-existing' });
    const unarchive = await client.unarchiveThread({ threadId: 'thr-existing' });

    expect(fork.thread).toMatchObject({
      id: 'thr-forked',
      forkedFromId: 'thr-existing',
      cwd: '/tmp/forked',
    });
    expect(unarchive.thread).toMatchObject({ id: 'thr-existing' });
    expect(transport.sent).toEqual([
      expect.objectContaining({ method: 'initialize' }),
      { method: 'initialized', params: {} },
      {
        method: 'thread/fork',
        id: 2,
        params: {
          threadId: 'thr-existing',
          cwd: '/tmp/forked',
          ephemeral: true,
        },
      },
      {
        method: 'thread/archive',
        id: 3,
        params: { threadId: 'thr-existing' },
      },
      {
        method: 'thread/unarchive',
        id: 4,
        params: { threadId: 'thr-existing' },
      },
    ]);
    expect(transport.sent).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'turn/start' }),
    ]));
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
      method: 'item/reasoning/textDelta',
      params: { text: 'Reasoning' },
    })).toEqual([{ type: 'thinking_delta', delta: 'Reasoning' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'turn/completed',
      params: { status: 'completed' },
    })).toEqual([{ type: 'done' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'turn/completed',
      params: { status: 'failed', message: 'Missing credentials' },
    })).toEqual([{ type: 'error', message: 'Missing credentials' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'turn/completed',
      params: {
        turn: {
          status: 'failed',
          error: { message: 'Missing environment variable: `STAFF_KEY`.' },
        },
      },
    })).toEqual([{ type: 'error', message: 'Missing environment variable: `STAFF_KEY`.' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'error',
      params: { message: 'Codex app-server unavailable' },
    })).toEqual([{ type: 'error', message: 'Codex app-server unavailable' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'error',
      params: { error: { message: 'Missing environment variable: `STAFF_KEY`.' } },
    })).toEqual([{ type: 'error', message: 'Missing environment variable: `STAFF_KEY`.' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'turn/failed',
      params: { error: { message: 'Provider env is missing' } },
    })).toEqual([{ type: 'error', message: 'Provider env is missing' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/command/started',
      params: {
        id: 'cmd-1',
        command: 'mindos file delete "Profile.md"',
        description: 'Delete a note',
      },
    })).toEqual([{
      type: 'tool_start',
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      args: 'mindos file delete "Profile.md"',
      runtime: 'codex',
    }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/permission/requested',
      params: {
        requestId: 'perm-1',
        toolName: 'Bash',
        command: 'mindos file delete "Profile.md"',
      },
    })).toEqual([{
      type: 'tool_start',
      toolCallId: 'perm-1',
      toolName: 'Bash',
      args: 'mindos file delete "Profile.md"',
      runtime: 'codex',
    }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/started',
      params: {
        item: {
          id: 'cmd-official-1',
          type: 'commandExecution',
          command: 'mindos search "permission"',
          status: 'running',
        },
      },
    })).toEqual([{
      type: 'tool_start',
      toolCallId: 'cmd-official-1',
      toolName: 'Bash',
      args: 'mindos search "permission"',
      runtime: 'codex',
    }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/commandExecution/outputDelta',
      params: {
        itemId: 'cmd-official-1',
        delta: 'Found 3 notes.\n',
      },
    })).toEqual([{
      type: 'tool_delta',
      toolCallId: 'cmd-official-1',
      toolName: 'Bash',
      delta: 'Found 3 notes.\n',
      runtime: 'codex',
    }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/completed',
      params: {
        item: {
          id: 'cmd-official-1',
          type: 'commandExecution',
          status: 'failed',
          error: { message: 'Command failed' },
        },
      },
    })).toEqual([{
      type: 'tool_end',
      toolCallId: 'cmd-official-1',
      toolName: 'Bash',
      output: 'Command failed',
      isError: true,
      runtime: 'codex',
    }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/completed',
      params: {
        item: {
          id: 'mcp-tool-1',
          type: 'mcpToolCall',
          server: { name: 'mindos' },
          tool: { name: 'search', result: 'Found 3 notes.' },
          status: 'completed',
        },
      },
    })).toEqual([{
      type: 'tool_end',
      toolCallId: 'mcp-tool-1',
      toolName: 'mindos.search',
      output: 'Found 3 notes.',
      isError: false,
      runtime: 'codex',
    }]);
  });

  it('includes the Codex JSON-RPC method, code, and data when a request fails', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const transport: CodexAppServerTransport = {
      send(message) {
        const record = message as { id?: number; method?: string };
        if (record.method === 'initialize') {
          queue.push({
            id: record.id!,
            error: {
              code: -32600,
              message: '',
              data: { expected: ['thread/start', 'turn/start'] },
            },
          });
        }
      },
      read() {
        return queue;
      },
    };

    const client = createCodexAppServerClient(transport);
    await expect(client.initialize()).rejects.toThrow(
      'Codex app-server initialize failed method=initialize code=-32600 data={"expected":["thread/start","turn/start"]}',
    );
  });

  it('rejects a Codex JSON-RPC request when transport send fails', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const transport: CodexAppServerTransport = {
      send(message) {
        const record = message as { method?: string };
        if (record.method === 'initialize') {
          throw new Error('stdio pipe closed');
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
    await expect(client.initialize()).rejects.toThrow('stdio pipe closed');
    await client.close?.();
  });

  it('rejects a Codex turn start request when the run is aborted', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const transport: CodexAppServerTransport = {
      send(message) {
        const record = message as { id?: number; method?: string };
        if (record.method === 'initialize') {
          queue.push({ id: record.id!, result: { userAgent: 'codex-test' } });
        }
        if (record.method === 'thread/start') {
          queue.push({ id: record.id!, result: { thread: { id: 'thr-new' } } });
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
    const thread = await client.startThread();
    const controller = new AbortController();
    const iterator = client.startTurn({
      threadId: thread.threadId,
      input: [{ type: 'text', text: 'Continue.' }],
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const next = iterator.next();
    controller.abort();
    await expect(next).rejects.toThrow('Codex app-server turn/start aborted.');
    await client.close?.();
  });

  it('rejects a Codex JSON-RPC request that never receives a response', async () => {
    vi.useFakeTimers();
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const transport: CodexAppServerTransport = {
      send() {},
      read() {
        return queue;
      },
      close() {
        queue.close();
      },
    };
    const client = createCodexAppServerClient(transport);

    try {
      const pending = client.initialize();
      const rejection = expect(pending).rejects.toThrow('Codex app-server initialize timed out after 60000ms.');
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
    } finally {
      await client.close?.();
      vi.useRealTimers();
    }
  });

  it('maps Codex app-server error notifications into visible stream errors', () => {
    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'error',
      params: { message: 'STAFF_KEY is not configured' },
    })).toEqual([{ type: 'error', message: 'STAFF_KEY is not configured' }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'error',
      params: {
        error: {
          code: 'auth_missing',
          message: 'Sign in to Codex',
        },
      },
    })).toEqual([{ type: 'error', message: 'Sign in to Codex' }]);
  });

  it('does not treat failed Codex turn/completed notifications as done', () => {
    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-1',
          status: 'failed',
          error: { message: 'model unavailable' },
        },
      },
    })).toEqual([{ type: 'error', message: 'model unavailable' }]);
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

  it('ends a Codex turn stream after app-server error notifications', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const transport: CodexAppServerTransport = {
      send(message) {
        const record = message as { id?: number; method?: string };
        if (record.method === 'initialize') {
          queue.push({ id: record.id!, result: { userAgent: 'codex-test' } });
        }
        if (record.method === 'thread/start') {
          queue.push({ id: record.id!, result: { thread: { id: 'thr-new' } } });
        }
        if (record.method === 'turn/start') {
          queue.push({ id: record.id!, result: { turn: { id: 'turn-1' } } });
          queue.push({ method: 'error', params: { message: 'STAFF_KEY is not configured' } });
          queue.push({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'failed' } } });
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
      { method: 'error', params: { message: 'STAFF_KEY is not configured' } },
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
    expect(transport.sent).toContainEqual({
      method: 'thread/start',
      id: 2,
      params: { cwd: '/tmp/mind' },
    });
    expect(events).toEqual([
      { type: 'status', visible: true, runtime: 'codex', message: 'Starting Codex locally.' },
      { type: 'runtime_binding', runtime: 'codex', externalSessionId: 'thr-new', cwd: '/tmp/mind' },
      { type: 'status', visible: true, runtime: 'codex', message: 'Codex is connected and working in this chat.' },
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

  it('marks an existing Codex thread binding failed when resume errors', async () => {
    const events: MindOSSSEvent[] = [];
    const client: CodexAppServerClient = {
      initialize: async () => {},
      startThread: async () => ({ threadId: 'unused' }),
      resumeThread: async () => {
        throw new Error('Codex thread missing');
      },
      listThreads: async () => ({ data: [], nextCursor: null, backwardsCursor: null }),
      readThread: async () => { throw new Error('unused'); },
      forkThread: async () => { throw new Error('unused'); },
      archiveThread: async () => {},
      unarchiveThread: async () => { throw new Error('unused'); },
      startTurn: async function* () {},
    };

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex', externalSessionId: 'thr-missing' },
      cwd: '/tmp/mind',
      prompt: 'Continue.',
      send: (event) => events.push(event),
      services: {
        createCodexClient: () => client,
      },
    });

    expect(result.error?.message).toBe('Codex thread missing');
    expect(events).toContainEqual({
      type: 'runtime_binding',
      runtime: 'codex',
      externalSessionId: 'thr-missing',
      cwd: '/tmp/mind',
      status: 'failed',
      reason: 'Codex thread missing',
    });
  });

  it('answers Codex app-server approval requests through the runtime permission service', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const sent: unknown[] = [];
    let requestedPermission: unknown;
    const transport: CodexAppServerTransport & { sent: unknown[] } = {
      sent,
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
          queue.push({
            id: 99,
            method: 'item/commandExecution/requestApproval',
            params: {
              itemId: 'cmd-1',
              command: 'mindos file delete "Profile.md"',
              reason: 'Delete a note',
            },
          });
          queue.push({ method: 'item/agentMessage/delta', params: { delta: 'Deleted.' } });
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

    const events: MindOSSSEvent[] = [];
    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Delete it.',
      send: (event) => events.push(event),
      services: {
        createCodexClient: ({ handleServerRequest }) => createCodexAppServerClient(transport, { handleServerRequest }),
        requestRuntimePermission: async (request) => {
          requestedPermission = request;
          return { decision: 'accept' };
        },
      },
    });

    expect(requestedPermission).toMatchObject({
      runtime: 'codex',
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      reason: 'Delete a note',
      input: {
        method: 'item/commandExecution/requestApproval',
        command: 'mindos file delete "Profile.md"',
      },
    });
    expect(transport.sent).toContainEqual({
      id: 99,
      result: { decision: 'accept' },
    });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'Deleted.' });
  });

  it('answers Codex app-server user input requests through the question service', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const sent: unknown[] = [];
    let requestedQuestion: unknown;
    const transport: CodexAppServerTransport & { sent: unknown[] } = {
      sent,
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
          queue.push({
            id: 100,
            method: 'item/tool/requestUserInput',
            params: {
              requestId: 'question-1',
              questions: [{
                question: 'Delete the CV review note?',
                header: 'Delete confirmation',
                options: [
                  { label: 'Delete', description: 'Remove the note.' },
                  { label: 'Keep', description: 'Leave it unchanged.' },
                ],
              }],
            },
          });
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

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Delete it.',
      send: () => {},
      services: {
        createCodexClient: ({ handleServerRequest }) => createCodexAppServerClient(transport, { handleServerRequest }),
        requestUserQuestion: async (request) => {
          requestedQuestion = request;
          return {
            answers: [{
              questionIndex: 0,
              question: 'Delete the CV review note?',
              kind: 'option',
              answer: 'Delete',
            }],
          };
        },
      },
    });

    expect(requestedQuestion).toMatchObject({
      runtime: 'codex',
      toolCallId: 'question-1',
      questions: [{
        question: 'Delete the CV review note?',
        header: 'Delete confirmation',
        options: [
          { label: 'Delete', description: 'Remove the note.' },
          { label: 'Keep', description: 'Leave it unchanged.' },
        ],
      }],
    });
    expect(transport.sent).toContainEqual({
      id: 100,
      result: {
        answers: [{
          questionIndex: 0,
          question: 'Delete the CV review note?',
          kind: 'option',
          answer: 'Delete',
        }],
      },
    });
  });

  it('cancels a pending Codex user input request when app-server resolves it first', async () => {
    const queue = new AsyncQueue<CodexAppServerMessage>();
    const sent: unknown[] = [];
    let sawAbort = false;
    const transport: CodexAppServerTransport & { sent: unknown[] } = {
      sent,
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
          queue.push({
            id: 100,
            method: 'item/tool/requestUserInput',
            params: {
              requestId: 'question-1',
              questions: [{ question: 'Continue?', header: 'Continue', options: ['Yes', 'No'] }],
            },
          });
          queue.push({ method: 'serverRequest/resolved', params: { requestId: 'question-1' } });
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

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Continue?',
      send: () => {},
      services: {
        createCodexClient: ({ handleServerRequest }) => createCodexAppServerClient(transport, { handleServerRequest }),
        requestUserQuestion: (_request, callOptions) => new Promise((resolve) => {
          callOptions?.signal?.addEventListener('abort', () => {
            sawAbort = true;
            resolve({ answers: [], cancelled: true, error: 'server_request_resolved' });
          }, { once: true });
        }),
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(sawAbort).toBe(true);
    expect(transport.sent).toContainEqual({
      id: 100,
      result: { cancelled: true, answers: [], error: 'server_request_resolved' },
    });
  });

  it('uses Claude Agent SDK by default and returns the session binding', async () => {
    const events: MindOSSSEvent[] = [];
    const sdk = createFakeClaudeSdk([
      { type: 'system', subtype: 'init', session_id: 'claude-sdk-session', cwd: '/tmp/mind' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello from SDK' }] }, session_id: 'claude-sdk-session' },
      { type: 'result', subtype: 'success', session_id: 'claude-sdk-session', is_error: false, result: '' },
    ]);

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      send: (event) => events.push(event),
      services: {
        loadClaudeSdk: () => sdk,
      },
    });

    expect(sdk.params).toMatchObject({
      prompt: 'Review this.',
      options: {
        cwd: '/tmp/mind',
        outputFormat: 'stream-json',
        permissionMode: 'default',
      },
    });
    expect(typeof sdk.params?.options?.canUseTool).toBe('function');
    expect(result).toEqual({ externalSessionId: 'claude-sdk-session' });
    expect(events).toEqual([
      { type: 'status', visible: true, runtime: 'claude', message: 'Starting Claude Code locally.' },
      { type: 'runtime_binding', runtime: 'claude', externalSessionId: 'claude-sdk-session', cwd: '/tmp/mind' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is connected and working in this chat.' },
      { type: 'text_delta', delta: 'Hello from SDK' },
      { type: 'done' },
    ]);
  });

  it('does not create the CLI permission prompt when Claude Agent SDK is available', async () => {
    const sdk = createFakeClaudeSdk([
      { type: 'result', subtype: 'success', session_id: 'claude-sdk-no-cli-prompt', is_error: false },
    ]);
    let promptCreated = false;

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Use SDK only.',
      send: () => {},
      services: {
        loadClaudeSdk: () => sdk,
        createClaudePermissionPrompt: () => {
          promptCreated = true;
          return {
            toolName: 'mcp__mindos_runtime_permission__mindos_runtime_permission',
            mcpConfig: '{"mcpServers":{}}',
          };
        },
      },
    });

    expect(promptCreated).toBe(false);
  });

  it('passes Claude Agent SDK permission prompts through the MindOS runtime permission bridge', async () => {
    let permissionResult: unknown;
    let capturedRequest: unknown;
    const sdk = createFakeClaudeSdk((params) => ({
      async *[Symbol.asyncIterator]() {
        const canUseTool = params.options?.canUseTool as (
          toolName: string,
          input: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => Promise<unknown>;
        permissionResult = await canUseTool('Bash', {
          command: 'rm Profile.md',
          description: 'Delete a note',
        }, {
          signal: new AbortController().signal,
          toolUseID: 'toolu-sdk-permission',
          title: 'Claude Code wants to run rm Profile.md',
          displayName: 'Run shell command',
          description: 'Claude Code will run a shell command.',
          suggestions: [{
            rules: [{ toolName: 'Bash', ruleContent: 'rm Profile.md' }],
            behavior: 'allow',
            destination: 'session',
          }],
        });
        yield { type: 'result', subtype: 'success', session_id: 'claude-sdk-permission', is_error: false };
      },
    }));

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Delete it.',
      send: () => {},
      services: {
        loadClaudeSdk: () => sdk,
        requestRuntimePermission: async (request) => {
          capturedRequest = request;
          return { decision: 'acceptForSession' };
        },
      },
    });

    expect(capturedRequest).toMatchObject({
      runtime: 'claude',
      toolCallId: 'toolu-sdk-permission',
      toolName: 'Bash',
      reason: 'Claude Code wants to run rm Profile.md',
      options: [
        { id: 'accept', label: 'Allow once' },
        { id: 'acceptForSession', label: 'Allow for session' },
        { id: 'decline', label: 'Deny' },
      ],
    });
    expect(permissionResult).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        command: 'rm Profile.md',
        description: 'Delete a note',
      },
      updatedPermissions: [{
        rules: [{ toolName: 'Bash', ruleContent: 'rm Profile.md' }],
        behavior: 'allow',
        destination: 'session',
      }],
      decisionClassification: 'user_permanent',
    });
  });

  it('passes Claude Agent SDK AskUserQuestion prompts through the MindOS question bridge', async () => {
    let questionResult: unknown;
    let capturedRequest: unknown;
    const sdk = createFakeClaudeSdk((params) => ({
      async *[Symbol.asyncIterator]() {
        const canUseTool = params.options?.canUseTool as (
          toolName: string,
          input: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => Promise<unknown>;
        questionResult = await canUseTool('AskUserQuestion', {
          questions: [{
            header: 'Delete note?',
            question: 'Should Claude Code delete Profile.md?',
            options: [
              { label: 'Delete', description: 'Delete the note.' },
              { label: 'Keep', description: 'Keep the note.' },
            ],
          }],
        }, {
          signal: new AbortController().signal,
          toolUseID: 'toolu-sdk-question',
          title: 'Claude Code needs a choice',
        });
        yield { type: 'result', subtype: 'success', session_id: 'claude-sdk-question', is_error: false };
      },
    }));

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Ask first.',
      send: () => {},
      services: {
        loadClaudeSdk: () => sdk,
        requestUserQuestion: async (request) => {
          capturedRequest = request;
          return {
            answers: [{
              questionIndex: 0,
              question: 'Should Claude Code delete Profile.md?',
              kind: 'option',
              answer: 'Delete',
            }],
          };
        },
      },
    });

    expect(capturedRequest).toMatchObject({
      runtime: 'claude',
      toolCallId: 'toolu-sdk-question',
      questions: [{
        header: 'Delete note?',
        question: 'Should Claude Code delete Profile.md?',
      }],
    });
    expect(questionResult).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        questions: [{
          header: 'Delete note?',
          question: 'Should Claude Code delete Profile.md?',
          multiSelect: false,
        }],
        answers: {
          'Should Claude Code delete Profile.md?': 'Delete',
        },
      },
      decisionClassification: 'user_temporary',
    });
  });

  it('falls back to the Claude Code CLI when the Claude Agent SDK is unavailable before the turn starts', async () => {
    const events: MindOSSSEvent[] = [];
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-cli-fallback' }),
    ]);

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Fallback.',
      send: (event) => events.push(event),
      services: {
        loadClaudeSdk: async () => {
          throw new Error('SDK missing');
        },
        createClaudeCliClient: () => createClaudeCodeCliClient(transport),
      },
    });

    expect(transport.argv).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      'Fallback.',
    ]);
    expect(result).toEqual({ externalSessionId: 'claude-cli-fallback' });
    expect(events).toContainEqual({
      type: 'status',
      visible: true,
      runtime: 'claude',
      message: 'Claude Agent SDK is unavailable; using Claude Code CLI fallback. SDK missing',
    });
  });

  it('streams Claude Code CLI output and returns the session binding when the legacy client override is used', async () => {
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
      { type: 'status', visible: true, runtime: 'claude', message: 'Starting Claude Code locally.' },
      { type: 'runtime_binding', runtime: 'claude', externalSessionId: 'claude-session-1', cwd: '/tmp/mind' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is connected and working in this chat.' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('maps readonly MindOS native mode to Claude Code dontAsk permission mode', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-readonly' }),
    ]);

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Read only.',
      permissionMode: 'readonly',
      send: () => {},
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
      'dontAsk',
      'Read only.',
    ]);
  });

  it('adds a Claude Code permission prompt MCP bridge when configured', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-2' }),
    ]);

    const client = createClaudeCodeCliClient(transport);
    const events = [];
    for await (const event of client.startTurn({
      prompt: 'Delete it.',
      cwd: '/tmp/mind',
      permissionPrompt: {
        toolName: 'mcp__mindos_runtime_permission__mindos_runtime_permission',
        mcpConfig: {
          mcpServers: {
            mindos_runtime_permission: {
              type: 'stdio',
              command: 'node',
              args: ['permission-server.mjs'],
            },
          },
        },
      },
    })) {
      events.push(event);
    }

    const argv = transport.argv ?? [];
    expect(argv).toContain('--mcp-config');
    expect(argv).toContain('--permission-prompt-tool');
    expect(argv).toContain('mcp__mindos_runtime_permission__mindos_runtime_permission');
    const mcpConfigArg = argv[argv.indexOf('--mcp-config') + 1] ?? '';
    expect(JSON.parse(mcpConfigArg)).toMatchObject({
      mcpServers: {
        mindos_runtime_permission: {
          type: 'stdio',
          command: 'node',
        },
      },
    });
    expect(events).toContainEqual({ type: 'done' });
  });

  it('fails fast when the Claude Code executable cannot be spawned', async () => {
    const client = createClaudeCodeCliClient(createClaudeCodeCliStdioTransport({
      command: '/tmp/mindos-missing-claude-code-binary',
    }));
    const iterator = client.startTurn({ prompt: 'Hello', cwd: '/tmp' });
    const result = (async () => {
      for await (const _event of iterator) {
        // drain
      }
    })();

    await expect(Promise.race([
      result,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Claude spawn hung.')), 1000)),
    ])).rejects.toThrow(/ENOENT|no such file|spawn/i);
  });

  it('passes the per-run Claude permission prompt service into the CLI adapter', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-3' }),
    ]);

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Delete it.',
      send: () => {},
      services: {
        createClaudeClient: () => createClaudeCodeCliClient(transport),
        createClaudePermissionPrompt: () => ({
          toolName: 'mcp__mindos_runtime_permission__mindos_runtime_permission',
          mcpConfig: '{"mcpServers":{"mindos_runtime_permission":{"type":"stdio","command":"node"}}}',
        }),
      },
    });

    expect(transport.argv).toContain('--permission-prompt-tool');
    expect(transport.argv).toContain('mcp__mindos_runtime_permission__mindos_runtime_permission');
  });

  it('maps Claude Code Bash tool use into a native runtime tool event', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'toolu-1',
            name: 'Bash',
            input: {
              command: 'mindos file delete "Profile.md"',
              description: 'Delete a note',
            },
          }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu-1',
            content: 'Deleted Profile.md',
          }],
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]);

    const client = createClaudeCodeCliClient(transport);
    const events = [];
    for await (const event of client.startTurn({ prompt: 'Delete it.', cwd: '/tmp/mind' })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'tool_start',
        toolCallId: 'toolu-1',
        toolName: 'Bash',
        args: {
          command: 'mindos file delete "Profile.md"',
          description: 'Delete a note',
        },
        runtime: 'claude',
      },
      {
        type: 'tool_end',
        toolCallId: 'toolu-1',
        output: 'Deleted Profile.md',
        isError: false,
        runtime: 'claude',
      },
      { type: 'done' },
    ]);
  });

  it('maps Claude Code permission denied system events into visible native runtime tool errors', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({
        type: 'system',
        subtype: 'permission_denied',
        tool_use_id: 'toolu-denied',
        tool_name: 'Bash',
        reason: 'User denied this command.',
        blockedPath: '/tmp/mind/Profile.md',
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]);

    const client = createClaudeCodeCliClient(transport);
    const events = [];
    for await (const event of client.startTurn({ prompt: 'Delete it.', cwd: '/tmp/mind' })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'tool_start',
        toolCallId: 'toolu-denied',
        toolName: 'Bash',
        args: {
          reason: 'User denied this command.',
          blockedPath: '/tmp/mind/Profile.md',
        },
        runtime: 'claude',
      },
      {
        type: 'tool_end',
        toolCallId: 'toolu-denied',
        output: 'User denied this command.',
        isError: true,
        runtime: 'claude',
      },
      { type: 'done' },
    ]);
  });

  it('maps Claude Code API retry system events into visible runtime status', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 548,
        error_status: 429,
        error: 'rate_limit',
        session_id: 'claude-retry-session',
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]);

    const client = createClaudeCodeCliClient(transport);
    const events = [];
    for await (const event of client.startTurn({ prompt: 'Say hi.', cwd: '/tmp/mind' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'session_id', sessionId: 'claude-retry-session' },
      {
        type: 'status',
        visible: true,
        runtime: 'claude',
        message: 'Claude Code HTTP 429; retrying (1/10). Retrying in 1s.',
      },
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

  it('marks an existing Claude Code session binding failed when resume errors', async () => {
    const events: MindOSSSEvent[] = [];
    const client: ClaudeCodeCliClient = {
      async *startTurn() {
        throw new Error('Claude resume failed');
      },
    };

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', externalSessionId: 'claude-existing' },
      cwd: '/tmp/mind',
      prompt: 'Continue.',
      send: (event) => events.push(event),
      services: {
        createClaudeClient: () => client,
      },
    });

    expect(result.error?.message).toBe('Claude resume failed');
    expect(events).toContainEqual({
      type: 'runtime_binding',
      runtime: 'claude',
      externalSessionId: 'claude-existing',
      cwd: '/tmp/mind',
      status: 'failed',
      reason: 'Claude resume failed',
    });
  });
});
