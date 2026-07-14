import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  createCodexAppServerClient,
  mapCodexAppServerNotificationToSseEvents,
  runMindosNativeAgentTurn,
  type CodexAppServerMessage,
  type CodexAppServerClient,
  type CodexAppServerTransport,
  type MindOSSSEvent
} from './index.js';

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

function pendingUntilAbort<T>(signal?: AbortSignal): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          await new Promise<never>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(signal.reason);
              return;
            }
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
          return { value: undefined as T, done: true };
        },
      };
    },
  };
}

function throwingAsyncIterable<T>(error: Error): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          throw error;
        },
      };
    },
  };
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
      if (record.method === 'model/list') {
        queue.push({
          id: record.id!,
          result: {
            data: [{
              id: 'gpt-5.6-sol',
              model: 'gpt-5.6-sol',
              displayName: 'GPT-5.6 Sol',
              description: 'Fast coding model',
              hidden: false,
              isDefault: true,
              supportedReasoningEfforts: [
                { reasoningEffort: 'low', description: 'Fastest' },
                { reasoningEffort: 'ultra', description: 'Maximum reasoning with delegation' },
              ],
              defaultReasoningEffort: 'low',
            }],
            nextCursor: null,
          },
        });
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

afterEach(() => {
  vi.useRealTimers();
});

describe('agent runtime adapters: Codex app-server', () => {
  it('drives Codex app-server over JSON-RPC and streams turn notifications', async () => {
    const transport = createFakeCodexTransport();
    const client = createCodexAppServerClient(transport, {
      clientInfo: { name: 'mindos_test', title: 'MindOS Test', version: '0.0.0' },
    });

    await client.initialize();
    const thread = await client.startThread({ cwd: '/tmp/mind', model: 'gpt-5.4-codex' });
    const notifications = [];
    for await (const notification of client.startTurn({
      threadId: thread.threadId,
      cwd: '/tmp/mind',
      input: [{ type: 'text', text: 'Summarize this repo.' }],
      model: 'gpt-5.4-codex',
      effort: 'high',
      approvalPolicy: 'never',
      sandbox: { mode: 'read-only' },
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
      { method: 'thread/start', id: 2, params: { cwd: '/tmp/mind', model: 'gpt-5.4-codex' } },
      {
        method: 'turn/start',
        id: 3,
        params: {
          threadId: 'thr-new',
          cwd: '/tmp/mind',
          input: [{ type: 'text', text: 'Summarize this repo.' }],
          model: 'gpt-5.4-codex',
          effort: 'high',
          approvalPolicy: 'never',
          sandbox: { mode: 'read-only' },
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

  it('lists model-advertised reasoning efforts without reducing them to a fixed enum', async () => {
    const transport = createFakeCodexTransport();
    const client = createCodexAppServerClient(transport);

    await client.initialize();
    const result = await client.listModels({ includeHidden: true, limit: 100 });

    expect(result).toEqual({
      data: [{
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        description: 'Fast coding model',
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fastest' },
          { reasoningEffort: 'ultra', description: 'Maximum reasoning with delegation' },
        ],
        defaultReasoningEffort: 'low',
      }],
      nextCursor: null,
    });
    expect(transport.sent).toContainEqual({
      method: 'model/list',
      id: 2,
      params: { includeHidden: true, limit: 100 },
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
      method: 'item/command/started',
      params: {
        id: 'cmd-secret',
        command: 'curl -H "Authorization: Bearer sk-secret-1234567890" https://example.test?token=abc123',
      },
    })).toEqual([{
      type: 'tool_start',
      toolCallId: 'cmd-secret',
      toolName: 'Bash',
      args: 'curl -H "Authorization: Bearer [redacted]" https://example.test?token=[redacted]',
      runtime: 'codex',
    }]);

    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/commandExecution/outputDelta',
      params: {
        itemId: 'cmd-secret',
        delta: 'token=abc123\n',
      },
    })).toEqual([{
      type: 'tool_delta',
      toolCallId: 'cmd-secret',
      toolName: 'Bash',
      delta: 'token=[redacted]\n',
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

    const rawCodexStack = [
      'file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102',
      'throw new Error(`^ Error: Missing optional dependency @openai/codex-darwin-x64. Reinstall Codex: npm install -g @openai/codex@latest',
      'at findCodexExecutable (file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102:9)',
      'at ModuleJob.run (node:internal/modules/esm/module_job:274:25)',
      'Node.js v22.16.0',
    ].join('\n');
    const mapped = mapCodexAppServerNotificationToSseEvents({
      method: 'error',
      params: { message: rawCodexStack },
    });
    expect(mapped).toEqual([{
      type: 'error',
      message: 'Codex is installed but incomplete. Reinstall Codex with "npm install -g @openai/codex@latest", then restart MindOS.',
    }]);
    expect(JSON.stringify(mapped)).not.toContain('file:///opt/homebrew');
    expect(JSON.stringify(mapped)).not.toContain('ModuleJob.run');
    expect(JSON.stringify(mapped)).not.toContain('Node.js v22.16.0');
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
    const result = await runMindosNativeAgentTurn({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Summarize this repo.',
      permissionMode: 'read',
      modelOverride: 'gpt-5.4-codex',
      reasoningEffort: 'high',
      send: (event) => events.push(event),
      services: {
        createCodexClient: () => createCodexAppServerClient(transport),
      },
    });

    expect(result).toEqual({ externalSessionId: 'thr-new' });
    expect(transport.sent).toContainEqual({
      method: 'thread/start',
      id: 2,
      params: { cwd: '/tmp/mind', model: 'gpt-5.4-codex' },
    });
    expect(transport.sent).toContainEqual({
      method: 'turn/start',
      id: 3,
      params: {
        threadId: 'thr-new',
        cwd: '/tmp/mind',
        input: [{ type: 'text', text: 'Summarize this repo.' }],
        model: 'gpt-5.4-codex',
        effort: 'high',
        approvalPolicy: 'never',
        sandbox: { mode: 'read-only' },
      },
    });
    expect(events).toEqual([
      { type: 'status', visible: true, runtime: 'codex', message: 'Starting Codex locally.' },
      { type: 'runtime_binding', runtime: 'codex', externalSessionId: 'thr-new', cwd: '/tmp/mind' },
      { type: 'status', visible: true, runtime: 'codex', message: 'Codex is connected and working in this chat.' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('maps MindOS permission modes to Codex approval and sandbox options', async () => {
    const cases = [
      {
        permissionMode: 'ask',
        expected: { approvalPolicy: 'untrusted', sandbox: { mode: 'workspace-write' } },
      },
      {
        permissionMode: 'auto',
        expected: { approvalPolicy: 'on-request', sandbox: { mode: 'workspace-write' } },
      },
      {
        permissionMode: 'full',
        expected: { approvalPolicy: 'never', sandbox: { mode: 'danger-full-access' } },
      },
    ] as const;

    for (const { permissionMode, expected } of cases) {
      const transport = createFakeCodexTransport();
      await runMindosNativeAgentTurn({
        runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
        cwd: '/tmp/mind',
        prompt: `Run with ${permissionMode}.`,
        permissionMode,
        send: () => {},
        services: {
          createCodexClient: () => createCodexAppServerClient(transport),
        },
      });

      expect(transport.sent).toContainEqual({
        method: 'turn/start',
        id: 3,
        params: {
          threadId: 'thr-new',
          cwd: '/tmp/mind',
          input: [{ type: 'text', text: `Run with ${permissionMode}.` }],
          ...expected,
        },
      });
    }
  });

  it('wraps selected skills as Codex text markers', async () => {
    const transport = createFakeCodexTransport();
    await runMindosNativeAgentTurn({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Summarize this repo.',
      selectedSkills: [{ name: 'super-researcher', source: 'user-selected' }],
      send: () => {},
      services: {
        createCodexClient: () => createCodexAppServerClient(transport),
      },
    });

    expect(transport.sent).toContainEqual({
      method: 'turn/start',
      id: 3,
      params: {
        threadId: 'thr-new',
        cwd: '/tmp/mind',
        input: [{ type: 'text', text: '$super-researcher\n\nSummarize this repo.' }],
        approvalPolicy: 'untrusted',
        sandbox: { mode: 'workspace-write' },
      },
    });
  });

  it('passes structured runtime attachments to Codex as path context and local images', async () => {
    const transport = createFakeCodexTransport();
    await runMindosNativeAgentTurn({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Inspect these attachments.',
      attachments: [
        {
          kind: 'uploaded_file',
          name: 'scan.pdf',
          content: '[PDF TEXT EXTRACTED: scan.pdf]\n\nExtracted text',
          mimeType: 'application/pdf',
          size: 9,
          dataBase64: 'cGRmLWJ5dGVz',
        },
        {
          kind: 'image',
          name: 'diagram.png',
          mimeType: 'image/png',
          data: 'aW1nLWJ5dGVz',
        },
      ],
      send: () => {},
      services: {
        createCodexClient: () => createCodexAppServerClient(transport),
      },
    });

    const turnStart = transport.sent.find((message): message is { method: string; params: { input: unknown[] } } => (
      !!message && typeof message === 'object'
      && (message as { method?: unknown }).method === 'turn/start'
    ));
    const input = turnStart?.params.input as Array<{ type: string; text?: string; path?: string }>;
    const textInput = input.find((item) => item.type === 'text');
    const imageInput = input.find((item) => item.type === 'localImage');

    expect(textInput?.text).toContain('Inspect these attachments.');
    expect(textInput?.text).toContain('## Runtime Attachment Files');
    expect(textInput?.text).toContain('scan.pdf');
    expect(textInput?.text).toContain('- materialized_from: original');
    expect(textInput?.text).toContain('diagram.png');
    expect(imageInput).toEqual({
      type: 'localImage',
      path: expect.stringContaining('mindos-runtime-attachments'),
    });
  });

  it('normalizes slash skill markers to Codex dollar markers', async () => {
    const transport = createFakeCodexTransport();
    await runMindosNativeAgentTurn({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: '/super-researcher Summarize this repo.',
      selectedSkills: [{ name: 'super-researcher', source: 'user-selected' }],
      send: () => {},
      services: {
        createCodexClient: () => createCodexAppServerClient(transport),
      },
    });

    expect(transport.sent).toContainEqual({
      method: 'turn/start',
      id: 3,
      params: {
        threadId: 'thr-new',
        cwd: '/tmp/mind',
        input: [{ type: 'text', text: '$super-researcher Summarize this repo.' }],
        approvalPolicy: 'untrusted',
        sandbox: { mode: 'workspace-write' },
      },
    });
  });

  it('resumes an existing Codex thread when the runtime carries an external session id', async () => {
    const transport = createFakeCodexTransport();
    await runMindosNativeAgentTurn({
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

  it('times out a stuck Codex native turn and interrupts the active thread', async () => {
    vi.useFakeTimers();
    const interruptTurn = vi.fn(async () => {});
    const client: CodexAppServerClient = {
      initialize: async () => {},
      startThread: async () => ({ threadId: 'thr-timeout' }),
      resumeThread: async () => ({ threadId: 'thr-timeout' }),
      listThreads: async () => ({ data: [], nextCursor: null, backwardsCursor: null }),
      readThread: async () => { throw new Error('unused'); },
      forkThread: async () => { throw new Error('unused'); },
      archiveThread: async () => {},
      unarchiveThread: async () => { throw new Error('unused'); },
      interruptTurn,
      startTurn: ({ signal }: { signal?: AbortSignal }) => pendingUntilAbort(signal),
    };
    const events: MindOSSSEvent[] = [];

    const resultPromise = runMindosNativeAgentTurn({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Hang.',
      timeoutMs: 100,
      send: (event) => events.push(event),
      services: {
        createCodexClient: () => client,
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.error).toMatchObject({
      message: 'Native runtime timed out after 1s.',
      code: 'TIMEOUT',
    });
    expect(interruptTurn).toHaveBeenCalledWith({ threadId: 'thr-timeout' });
    expect(events).toContainEqual({
      type: 'runtime_binding',
      runtime: 'codex',
      externalSessionId: 'thr-timeout',
      cwd: '/tmp/mind',
      status: 'failed',
      reason: 'Native runtime timed out after 1s.',
    });
  });

  it('times out a stuck Codex app-server initialization before a thread exists', async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => {});
    const client: CodexAppServerClient = {
      initialize: async ({ signal }: { signal?: AbortSignal } = {}) => {
        await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      startThread: async () => { throw new Error('unused'); },
      resumeThread: async () => { throw new Error('unused'); },
      listThreads: async () => ({ data: [], nextCursor: null, backwardsCursor: null }),
      readThread: async () => { throw new Error('unused'); },
      forkThread: async () => { throw new Error('unused'); },
      archiveThread: async () => {},
      unarchiveThread: async () => { throw new Error('unused'); },
      startTurn: () => throwingAsyncIterable(new Error('unused')),
      close,
    };
    const events: MindOSSSEvent[] = [];

    const resultPromise = runMindosNativeAgentTurn({
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      cwd: '/tmp/mind',
      prompt: 'Hang during initialize.',
      timeoutMs: 100,
      send: (event) => events.push(event),
      services: {
        createCodexClient: () => client,
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.error).toMatchObject({
      message: 'Native runtime timed out after 1s.',
      code: 'TIMEOUT',
    });
    expect(close).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'status',
      runtime: 'codex',
      message: 'Starting Codex locally.',
      visible: true,
    });
    expect(events).toContainEqual({
      type: 'error',
      message: 'Codex native runtime error: Native runtime timed out after 1s.',
    });
    expect(events.some((event) => event.type === 'runtime_binding')).toBe(false);
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

    const result = await runMindosNativeAgentTurn({
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
    await runMindosNativeAgentTurn({
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

    await runMindosNativeAgentTurn({
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
});
