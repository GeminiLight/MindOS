import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  createClaudeCodeCliClient,
  createClaudeCodeCliStdioTransport,
  createCodexAppServerClient,
  runMindosNativeAgentTurn,
  type CodexAppServerMessage,
  type CodexAppServerTransport,
  type ClaudeCodeCliClient,
  type ClaudeCodeCliTransport,
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

function pendingForever<T>(options: { onReturn?: () => void } = {}): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          return new Promise<IteratorResult<T>>(() => {});
        },
        return(): Promise<IteratorResult<T>> {
          options.onReturn?.();
          return Promise.resolve({ value: undefined as T, done: true });
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

afterEach(() => {
  vi.useRealTimers();
});

describe('agent runtime adapters: Claude Code', () => {
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

    await runMindosNativeAgentTurn({
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

  it('runs the detected local claude CLI with the runtime env and returns the session binding', async () => {
    const events: MindOSSSEvent[] = [];
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-cli-session', cwd: '/tmp/mind' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello from CLI' }] }, session_id: 'claude-cli-session' }),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-cli-session', is_error: false, result: '' }),
    ]);
    let captured: { cwd: string; command?: string; env?: NodeJS.ProcessEnv } | null = null;

    const result = await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      modelOverride: 'claude-sonnet-4-20250514',
      reasoningEffort: 'high',
      runtimeEnv: { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token' } as NodeJS.ProcessEnv,
      send: (event) => events.push(event),
      services: {
        createClaudeCliClient: (options) => {
          captured = options;
          return createClaudeCodeCliClient(transport);
        },
      },
    });

    expect(captured).toMatchObject({
      cwd: '/tmp/mind',
      command: '/usr/local/bin/claude',
      env: { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token' },
    });
    expect(transport.argv).toEqual([
      '--print', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'default',
      '--model', 'claude-sonnet-4-20250514',
      '--effort', 'high',
      '--', 'Review this.',
    ]);
    expect(result).toEqual({ externalSessionId: 'claude-cli-session' });
    expect(events).toEqual([
      { type: 'status', visible: true, runtime: 'claude', message: 'Starting Claude Code locally.' },
      { type: 'runtime_binding', runtime: 'claude', externalSessionId: 'claude-cli-session', cwd: '/tmp/mind' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is connected and working in this chat.' },
      { type: 'text_delta', delta: 'Hello from CLI' },
      { type: 'done' },
    ]);
  });

  it('invokes a selected skill through its slash command, which the CLI resolves natively', async () => {
    const transport = createFakeClaudeTransport([JSON.stringify({ type: 'result', subtype: 'success', session_id: 's' })]);
    await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      selectedSkills: [{ name: 'doc-review', source: 'user-selected' }],
      send: () => {},
      services: { createClaudeClient: () => createClaudeCodeCliClient(transport) },
    });
    expect(transport.argv?.at(-1)).toBe('/doc-review Review this.');
  });

  it('does not repeat a skill the user already invoked by name', async () => {
    const transport = createFakeClaudeTransport([JSON.stringify({ type: 'result', subtype: 'success', session_id: 's' })]);
    await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: '/doc-review the intro',
      selectedSkills: [{ name: 'doc-review', source: 'user-selected' }],
      send: () => {},
      services: { createClaudeClient: () => createClaudeCodeCliClient(transport) },
    });
    expect(transport.argv?.at(-1)).toBe('/doc-review the intro');
  });

  it('does not start Claude Code without a detected local CLI path', async () => {
    const events: MindOSSSEvent[] = [];
    const createClaudeCliClient = vi.fn();

    const result = await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      send: (event) => events.push(event),
      services: { createClaudeCliClient },
    });

    expect(createClaudeCliClient).not.toHaveBeenCalled();
    expect(result.error?.message).toContain('requires a local claude executable');
    expect(events).toContainEqual({
      type: 'error',
      message: expect.stringContaining('Install Claude Code and restart MindOS'),
    });
  });

  it('streams Claude Code CLI output and returns the session binding when the legacy client override is used', async () => {
    const events: MindOSSSEvent[] = [];
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-1' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-1' }),
    ]);

    const result = await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
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
      '--',
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

  it('adds runtime attachment paths to Claude Code CLI prompts as a fallback', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-cli-attachment-paths' }),
    ]);

    await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Use the uploaded file.',
      attachments: [{
        kind: 'uploaded_file',
        name: 'brief.txt',
        content: 'hello',
        mimeType: 'text/plain',
        size: 5,
      }],
      send: () => {},
      services: {
        createClaudeClient: () => createClaudeCodeCliClient(transport),
      },
    });

    const promptArg = transport.argv?.at(-1) ?? '';
    expect(promptArg).toContain('Use the uploaded file.');
    expect(promptArg).toContain('## Runtime Attachment Files');
    expect(promptArg).toContain('brief.txt');
    expect(promptArg).toContain('mindos-runtime-attachments');
    expect(promptArg).toContain('- materialized_from: text_projection');
  });

  it('maps read MindOS native mode to Claude Code dontAsk permission mode', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-readonly' }),
    ]);

    await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Read only.',
      permissionMode: 'read',
      modelOverride: 'claude-sonnet-4-20250514',
      reasoningEffort: 'high',
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
      '--model',
      'claude-sonnet-4-20250514',
      '--effort',
      'high',
      '--',
      'Read only.',
    ]);
  });

  it('maps MindOS Plan agent mode to Claude Code native plan permission mode', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-plan' }),
    ]);

    await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Plan the migration.',
      permissionMode: 'read',
      agentMode: 'plan',
      send: () => {},
      services: {
        createClaudeClient: () => createClaudeCodeCliClient(transport),
      },
    });

    const argv = transport.argv ?? [];
    expect(argv.slice(0, 7)).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'plan',
      '--',
    ]);
    expect(argv.at(-1)).toBe('Plan the migration.');
  });

  it('maps interactive MindOS modes to Claude Code CLI permission modes', async () => {
    const cases = [
      { permissionMode: 'ask', expected: 'default' },
      { permissionMode: 'auto', expected: 'auto' },
      { permissionMode: 'full', expected: 'bypassPermissions' },
    ] as const;

    for (const { permissionMode, expected } of cases) {
      const transport = createFakeClaudeTransport([
        JSON.stringify({ type: 'result', subtype: 'success', session_id: `claude-session-${permissionMode}` }),
      ]);

      await runMindosNativeAgentTurn({
        runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
        cwd: '/tmp/mind',
        prompt: `Run with ${permissionMode}.`,
        permissionMode,
        send: () => {},
        services: {
          createClaudeClient: () => createClaudeCodeCliClient(transport),
        },
      });

      const argv = transport.argv ?? [];
      expect(argv.slice(0, 6)).toEqual([
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        expected,
      ]);
      expect(argv.at(-1)).toBe(`Run with ${permissionMode}.`);
    }
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

    await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
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

    const argv = transport.argv ?? [];
    expect(argv).toContain('--permission-prompt-tool');
    expect(argv).toContain('mcp__mindos_runtime_permission__mindos_runtime_permission');
    expect(argv).not.toContain('--skills');
    expect(argv[argv.length - 1]).toBe('Delete it.');
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

  it('redacts secrets from Claude Code CLI tool events', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu-secret',
              name: 'Bash',
              input: {
                command: 'curl -H "Authorization: Bearer sk-secret-1234567890" https://example.test?token=abc123',
                env: { API_KEY: 'sk-secret-abcdefghijkl' },
              },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu-secret',
              content: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
            },
          ],
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]);

    const client = createClaudeCodeCliClient(transport);
    const events = [];
    for await (const event of client.startTurn({ prompt: 'Run secret command.', cwd: '/tmp/mind' })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'tool_start',
        toolCallId: 'toolu-secret',
        toolName: 'Bash',
        args: {
          command: 'curl -H "Authorization: Bearer [redacted]" https://example.test?token=[redacted]',
          env: { API_KEY: '[redacted]' },
        },
        runtime: 'claude',
      },
      {
        type: 'tool_end',
        toolCallId: 'toolu-secret',
        output: 'Authorization: Bearer [redacted]',
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

    await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude', externalSessionId: 'claude-existing' },
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
      startTurn: () => throwingAsyncIterable(new Error('Claude resume failed')),
    };

    const result = await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude', externalSessionId: 'claude-existing' },
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

  it('times out a stuck Claude Code native turn', async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => {});
    const client: ClaudeCodeCliClient = {
      close,
      startTurn: ({ signal }: { signal?: AbortSignal }) => pendingUntilAbort(signal),
    };
    const events: MindOSSSEvent[] = [];

    const resultPromise = runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude', externalSessionId: 'claude-existing' },
      cwd: '/tmp/mind',
      prompt: 'Hang.',
      timeoutMs: 100,
      send: (event) => events.push(event),
      services: {
        createClaudeClient: () => client,
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
      type: 'runtime_binding',
      runtime: 'claude',
      externalSessionId: 'claude-existing',
      cwd: '/tmp/mind',
      status: 'failed',
      reason: 'Native runtime timed out after 1s.',
    });
  });

  it('hard-times out a Claude Code native turn even when the stream ignores abort', async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => {});
    const iteratorReturn = vi.fn();
    const client: ClaudeCodeCliClient = {
      close,
      startTurn: () => pendingForever({ onReturn: iteratorReturn }),
    };
    const events: MindOSSSEvent[] = [];

    const resultPromise = runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude', externalSessionId: 'claude-existing' },
      cwd: '/tmp/mind',
      prompt: 'Hang without observing the signal.',
      timeoutMs: 100,
      send: (event) => events.push(event),
      services: {
        createClaudeClient: () => client,
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.error).toMatchObject({
      message: 'Native runtime timed out after 1s.',
      code: 'TIMEOUT',
    });
    expect(iteratorReturn).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'runtime_binding',
      runtime: 'claude',
      externalSessionId: 'claude-existing',
      cwd: '/tmp/mind',
      status: 'failed',
      reason: 'Native runtime timed out after 1s.',
    });
  });

});

describe('Claude native lane terminal failure reporting', () => {
  it('returns result.error when the Claude Code CLI result is_error instead of recording the run as completed', async () => {
    const events: MindOSSSEvent[] = [];
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-err' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working' }] } }),
      JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Credit balance is too low', session_id: 'claude-session-err' }),
    ]);

    const result = await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      send: (event) => events.push(event),
      services: {
        createClaudeClient: () => createClaudeCodeCliClient(transport),
      },
    });

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('Credit balance is too low');
    expect(result.externalSessionId).toBe('claude-session-err');
    expect(events.filter((event) => event.type === 'error')).toEqual([{ type: 'error', message: 'Credit balance is too low' }]);
    expect(events).not.toContainEqual({ type: 'done' });
    expect(events.some((event) => event.type === 'runtime_binding' && event.status === 'failed')).toBe(false);
  });

  it('keeps a successful Claude turn free of errors', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-ok' }),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-ok', result: 'Done' }),
    ]);
    const result = await runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      send: () => {},
      services: {
        createClaudeClient: () => createClaudeCodeCliClient(transport),
      },
    });
    expect(result).toEqual({ externalSessionId: 'claude-ok' });
  });
});

describe('Claude native lane user cancellation', () => {
  it('reports a user cancel as a neutral status and a canceled result instead of a stream error', async () => {
    const controller = new AbortController();
    const close = vi.fn(async () => {});
    const client: ClaudeCodeCliClient = {
      close,
      startTurn: ({ signal }: { signal?: AbortSignal }) => pendingUntilAbort(signal),
    };
    const events: MindOSSSEvent[] = [];

    const resultPromise = runMindosNativeAgentTurn({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude', externalSessionId: 'claude-existing' },
      cwd: '/tmp/mind',
      prompt: 'Hang until canceled.',
      signal: controller.signal,
      send: (event) => events.push(event),
      services: {
        createClaudeClient: () => client,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const result = await resultPromise;

    expect(result.error).toBeInstanceOf(Error);
    expect(result.externalSessionId).toBe('claude-existing');
    expect(close).toHaveBeenCalled();
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events).toContainEqual({ type: 'status', visible: true, runtime: 'claude', message: 'Canceled by user.' });
    expect(events.some((event) => event.type === 'runtime_binding' && event.status === 'failed')).toBe(false);
  });
});
