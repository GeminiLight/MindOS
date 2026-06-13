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
  runMindosAgentRuntimeAskSession,
  type CodexAppServerMessage,
  type CodexAppServerTransport,
  type ClaudeCodeCliClient,
  type ClaudeCodeCliTransport,
  type ClaudeCodeSdkModule,
  type MindOSSSEvent
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

  it('uses Claude Agent SDK bridge with a detected local CLI path and returns the session binding', async () => {
    const events: MindOSSSEvent[] = [];
    const sdk = createFakeClaudeSdk([
      { type: 'system', subtype: 'init', session_id: 'claude-sdk-session', cwd: '/tmp/mind' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello from SDK' }] }, session_id: 'claude-sdk-session' },
      { type: 'result', subtype: 'success', session_id: 'claude-sdk-session', is_error: false, result: '' },
    ]);

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      runtimeEnv: { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token' } as NodeJS.ProcessEnv,
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
        pathToClaudeCodeExecutable: '/usr/local/bin/claude',
        env: {
          PATH: '/usr/bin',
          CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token',
        },
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

  it('does not start Claude Code without a detected local CLI path', async () => {
    const events: MindOSSSEvent[] = [];
    const loadClaudeSdk = vi.fn(async () => createFakeClaudeSdk([]));

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code' },
      cwd: '/tmp/mind',
      prompt: 'Review this.',
      send: (event) => events.push(event),
      services: {
        loadClaudeSdk,
      },
    });

    expect(loadClaudeSdk).not.toHaveBeenCalled();
    expect(result.error?.message).toContain('requires a local claude executable');
    expect(events).toContainEqual({
      type: 'error',
      message: expect.stringContaining('MindOS does not bundle the Claude Agent SDK native runtime'),
    });
  });

  it('passes a detected Claude Code CLI path to the Claude Agent SDK', async () => {
    const sdk = createFakeClaudeSdk([
      { type: 'result', subtype: 'success', session_id: 'claude-sdk-cli-path', is_error: false },
    ]);

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/Users/tester/.local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Use SDK with explicit CLI path.',
      send: () => {},
      services: {
        loadClaudeSdk: () => sdk,
      },
    });

    expect(sdk.params?.options).toMatchObject({
      pathToClaudeCodeExecutable: '/Users/tester/.local/bin/claude',
    });
  });

  it('redacts secrets from Claude Agent SDK tool events', async () => {
    const events: MindOSSSEvent[] = [];
    const sdk = createFakeClaudeSdk([
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'toolu-sdk-secret',
            name: 'Bash',
            input: {
              command: 'curl -H "Authorization: Bearer sk-sdk-secret-1234567890" https://example.test?token=abc123',
              env: { API_KEY: 'sk-sdk-secret-abcdefghijkl' },
            },
          }],
        },
        session_id: 'claude-sdk-secret',
      },
      {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu-sdk-secret',
            content: 'token=abc123secret',
          }],
        },
        session_id: 'claude-sdk-secret',
      },
      { type: 'result', subtype: 'success', session_id: 'claude-sdk-secret', is_error: false },
    ]);

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Run secret command.',
      send: (event) => events.push(event),
      services: {
        loadClaudeSdk: () => sdk,
      },
    });

    expect(events).toEqual([
      { type: 'status', visible: true, runtime: 'claude', message: 'Starting Claude Code locally.' },
      { type: 'runtime_binding', runtime: 'claude', externalSessionId: 'claude-sdk-secret', cwd: '/tmp/mind' },
      { type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is connected and working in this chat.' },
      {
        type: 'tool_start',
        toolCallId: 'toolu-sdk-secret',
        toolName: 'Bash',
        args: {
          command: 'curl -H "Authorization: Bearer [redacted]" https://example.test?token=[redacted]',
          env: { API_KEY: '[redacted]' },
        },
        runtime: 'claude',
      },
      {
        type: 'tool_end',
        toolCallId: 'toolu-sdk-secret',
        output: 'token=[redacted]',
        isError: false,
        runtime: 'claude',
      },
      { type: 'done' },
    ]);
  });

  it('does not create the CLI permission prompt when Claude Agent SDK is available', async () => {
    const sdk = createFakeClaudeSdk([
      { type: 'result', subtype: 'success', session_id: 'claude-sdk-no-cli-prompt', is_error: false },
    ]);
    let promptCreated = false;

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
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
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
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
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
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
    let capturedCliOptions: { cwd: string; signal?: AbortSignal; command?: string } | null = null;

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/opt/homebrew/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Fallback.',
      send: (event) => events.push(event),
      services: {
        loadClaudeSdk: async () => {
          throw new Error('SDK missing');
        },
        createClaudeCliClient: (options) => {
          capturedCliOptions = options;
          return createClaudeCodeCliClient(transport);
        },
      },
    });

    expect(capturedCliOptions).toMatchObject({
      cwd: '/tmp/mind',
      command: '/opt/homebrew/bin/claude',
    });
    expect(transport.argv).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--',
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

  it('falls back to the Claude Code CLI when the Claude Agent SDK native binary fails during turn start', async () => {
    const events: MindOSSSEvent[] = [];
    const sdk = createFakeClaudeSdk(() => throwingAsyncIterable(
      new Error('Native CLI binary for darwin-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.'),
    ));
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-cli-after-sdk-failure' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'CLI fallback ok' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-cli-after-sdk-failure' }),
    ]);
    let capturedCliOptions: { cwd: string; signal?: AbortSignal; command?: string; env?: NodeJS.ProcessEnv } | null = null;

    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/Users/tester/.local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Fallback after SDK start.',
      runtimeEnv: { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token' } as NodeJS.ProcessEnv,
      send: (event) => events.push(event),
      services: {
        loadClaudeSdk: async () => sdk,
        createClaudeCliClient: (options) => {
          capturedCliOptions = options;
          return createClaudeCodeCliClient(transport);
        },
      },
    });

    expect(capturedCliOptions).toMatchObject({
      cwd: '/tmp/mind',
      command: '/Users/tester/.local/bin/claude',
      env: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token' }),
    });
    expect(result).toEqual({ externalSessionId: 'claude-cli-after-sdk-failure' });
    expect(events).toContainEqual({
      type: 'status',
      visible: true,
      runtime: 'claude',
      message: expect.stringContaining('using Claude Code CLI fallback'),
    });
    expect(events).toContainEqual({
      type: 'text_delta',
      delta: 'CLI fallback ok',
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

  it('maps readonly MindOS native mode to Claude Code dontAsk permission mode', async () => {
    const transport = createFakeClaudeTransport([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'claude-session-readonly' }),
    ]);

    await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
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
      '--',
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

    await runMindosAgentRuntimeAskSession({
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

    const result = await runMindosAgentRuntimeAskSession({
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

    const resultPromise = runMindosAgentRuntimeAskSession({
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

    const resultPromise = runMindosAgentRuntimeAskSession({
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

  it('hard-times out a Claude Agent SDK query when the SDK iterator ignores abort and close', async () => {
    vi.useFakeTimers();
    const interrupt = vi.fn(async () => {});
    const close = vi.fn();
    const iteratorReturn = vi.fn(() => new Promise<IteratorResult<Record<string, unknown>>>(() => {}));
    const sdk = createFakeClaudeSdk(() => {
      let nextCount = 0;
      const iterator: AsyncIterator<Record<string, unknown>> = {
        next() {
          nextCount += 1;
          if (nextCount === 1) {
            return Promise.resolve({
              value: { type: 'system', subtype: 'init', session_id: 'claude-sdk-timeout' },
              done: false,
            });
          }
          return new Promise<IteratorResult<Record<string, unknown>>>(() => {});
        },
        return: iteratorReturn,
      };
      return {
        interrupt,
        close,
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
    });
    const events: MindOSSSEvent[] = [];

    const resultPromise = runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp/mind',
      prompt: 'Hang in SDK.',
      timeoutMs: 100,
      send: (event) => events.push(event),
      services: {
        loadClaudeSdk: () => sdk,
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.error).toMatchObject({
      message: 'Native runtime timed out after 1s.',
      code: 'TIMEOUT',
    });
    expect(result.externalSessionId).toBe('claude-sdk-timeout');
    expect(interrupt).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(iteratorReturn).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'runtime_binding',
      runtime: 'claude',
      externalSessionId: 'claude-sdk-timeout',
      cwd: '/tmp/mind',
      status: 'failed',
      reason: 'Native runtime timed out after 1s.',
    });
    expect(events).toContainEqual({
      type: 'error',
      message: 'Claude Code native runtime error: Native runtime timed out after 1s.',
    });
    expect(events).not.toContainEqual({ type: 'done' });
  });
});
