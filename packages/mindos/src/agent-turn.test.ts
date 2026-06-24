import { describe, expect, it } from 'vitest';
import {
  MINDOS_AGENT_TURN_STREAM_EVENT_TYPES,
  MINDOS_SSE_HEADERS,
  MINDOS_SESSION_STREAM_SCHEMA,
  createMindosAgentEventReducer,
  createMindosSessionEvent,
  encodeMindosSseEvent,
  createMindosUploadedFileParts,
  dirnameOfMindosPath,
  expandMindosAgentAttachedFiles,
  detectMindosAgentLoop,
  getTextDelta,
  getToolExecutionEnd,
  getToolExecutionStart,
  isTextDeltaEvent,
  isToolExecutionEndEvent,
  isToolExecutionStartEvent,
  isMindosRetryableError,
  isMindosTransientError,
  loadMindosAgentFileContext,
  normalizeMindosAgentStepLimit,
  parseMindosSseLine,
  resolveMindosAgentTimeoutMs,
  mindosRetryDelay,
  mapMindosAcpUpdateToSseEvents,
  buildMindosCompatEndpointCandidates,
  mindosPiMessagesToOpenAI,
  parseMindosOpenAICompatResponse,
  reassembleMindosOpenAISse,
  buildMindosExternalRuntimePrompt,
  runMindosAcpAgentTurn,
  runMindosNonStreamingFallback,
  runMindosOpenAICompatFallback,
  runMindosAgentTurnWithRetry,
  safeParseMindosJsonObject,
  sanitizeToolArgs,
  sanitizeToolOutput,
  sleepMindos,
  toMindosAgentMessages,
} from './agent/turn/index.js';
import {
  createMindosPiAgentRuntime,
  runMindosPiAgentTurnProxyFallback,
  runMindosPiAgentTurnSession,
} from './agent/mindos-pi/index.js';

describe('MindOS session event contract', () => {
  it('defines a versioned event stream schema', () => {
    expect(MINDOS_SESSION_STREAM_SCHEMA).toMatchObject({
      protocol: 'mindos.session.events',
      version: 1,
    });
    expect(MINDOS_SESSION_STREAM_SCHEMA.events).toContain('message.delta');
    expect(MINDOS_SESSION_STREAM_SCHEMA.events).toContain('tool.completed');
  });

  it('creates timestamped session events', () => {
    const event = createMindosSessionEvent({
      id: 'evt-1',
      type: 'session.started',
      sessionId: 'ses-1',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(event).toEqual({
      id: 'evt-1',
      type: 'session.started',
      sessionId: 'ses-1',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('defines the agent turn SSE event contract and encodes data frames', () => {
    expect(MINDOS_AGENT_TURN_STREAM_EVENT_TYPES).toEqual([
      'text_delta',
      'thinking_delta',
      'agent_run_context',
      'context_usage',
      'tool_start',
      'tool_delta',
      'tool_end',
      'runtime_permission_request',
      'runtime_permission_resolved',
      'user_question_start',
      'user_question_answered',
      'user_question_cancelled',
      'runtime_binding',
      'done',
      'error',
      'status',
    ]);
    expect(MINDOS_SSE_HEADERS).toMatchObject({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
    });

    const encoded = encodeMindosSseEvent({ type: 'text_delta', delta: 'hello' });
    expect(encoded).toBe('data:{"type":"text_delta","delta":"hello"}\n\n');
    expect(parseMindosSseLine(encoded.trim())).toEqual({ type: 'text_delta', delta: 'hello' });
    expect(parseMindosSseLine(encodeMindosSseEvent({
      type: 'context_usage',
      runtime: 'mindos',
      phase: 'preflight',
      action: 'history_pruned',
      percent: 72,
      usedTokens: 72_000,
      contextWindow: 100_000,
      budgetTokens: 84_000,
      reserveTokens: 16_000,
      systemPromptTokens: 10_000,
      turnPromptTokens: 12_000,
      historyTokens: 50_000,
    }).trim())).toMatchObject({
      type: 'context_usage',
      runtime: 'mindos',
      action: 'history_pruned',
      percent: 72,
    });
    expect(parseMindosSseLine(encodeMindosSseEvent({
      type: 'agent_run_context',
      rootRunId: 'root-1',
      chatSessionId: 'chat-1',
      startedAt: 123,
    }).trim())).toEqual({
      type: 'agent_run_context',
      rootRunId: 'root-1',
      chatSessionId: 'chat-1',
      startedAt: 123,
    });
    expect(parseMindosSseLine(encodeMindosSseEvent({
      type: 'runtime_binding',
      runtime: 'codex',
      externalSessionId: 'thr_123',
      cwd: '/tmp/mind',
    }).trim())).toEqual({
      type: 'runtime_binding',
      runtime: 'codex',
      externalSessionId: 'thr_123',
      cwd: '/tmp/mind',
    });
    expect(parseMindosSseLine(encodeMindosSseEvent({
      type: 'user_question_start',
      runId: 'run_1',
      toolCallId: 'tool_1',
      questions: [{ header: 'Scope', question: 'Proceed?', options: [] }],
    }).trim())).toEqual({
      type: 'user_question_start',
      runId: 'run_1',
      toolCallId: 'tool_1',
      questions: [{ header: 'Scope', question: 'Proceed?', options: [] }],
    });
    expect(parseMindosSseLine(encodeMindosSseEvent({
      type: 'runtime_permission_request',
      runId: 'run_1',
      requestId: 'perm_1',
      runtime: 'codex',
      toolCallId: 'tool_1',
      toolName: 'Bash',
      input: { command: 'npm test' },
      options: [{ id: 'accept', label: 'Allow once', intent: 'allow' }],
    }).trim())).toEqual({
      type: 'runtime_permission_request',
      runId: 'run_1',
      requestId: 'perm_1',
      runtime: 'codex',
      toolCallId: 'tool_1',
      toolName: 'Bash',
      input: { command: 'npm test' },
      options: [{ id: 'accept', label: 'Allow once', intent: 'allow' }],
    });
    expect(parseMindosSseLine('event: ping')).toBeNull();
    expect(parseMindosSseLine('data: not-json')).toBeNull();
  });

  it('extracts pi-agent stream events without depending on Web modules', () => {
    const textEvent = { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } };
    expect(isTextDeltaEvent(textEvent)).toBe(true);
    expect(getTextDelta(textEvent)).toBe('hi');

    const startEvent = {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'write_file',
      args: { content: 'x'.repeat(250) },
    };
    expect(isToolExecutionStartEvent(startEvent)).toBe(true);
    expect(getToolExecutionStart(startEvent)).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'write_file',
    });

    const endEvent = {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      result: { content: [{ type: 'text', text: 'ok' }] },
      isError: false,
    };
    expect(isToolExecutionEndEvent(endEvent)).toBe(true);
    expect(getToolExecutionEnd(endEvent)).toEqual({
      toolCallId: 'call-1',
      output: 'ok',
      isError: false,
    });
  });

  it('reduces pi-agent events into SSE events and execution effects', () => {
    const reducer = createMindosAgentEventReducer({ stepLimit: 2 });

    expect(reducer.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
    })).toEqual({
      events: [{ type: 'text_delta', delta: 'hi' }],
      hasVisibleContent: true,
    });

    expect(reducer.handle({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'write_file',
      args: { content: 'x'.repeat(250) },
    })).toEqual({
      events: [{ type: 'tool_start', toolCallId: 'call-1', toolName: 'write_file', args: { content: '[250 chars]' } }],
      hasVisibleContent: true,
    });

    expect(reducer.handle({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      result: { content: [{ type: 'text', text: 'ok' }] },
      isError: false,
    })).toEqual({
      events: [{ type: 'tool_end', toolCallId: 'call-1', output: 'ok', isError: false }],
      hasVisibleContent: false,
      toolExecutions: 1,
    });
  });

  it('reduces turn end events into token, loop, and step-limit effects', () => {
    const reducer = createMindosAgentEventReducer({ stepLimit: 3 });

    expect(reducer.handle({
      type: 'turn_end',
      usage: { inputTokens: 10, outputTokens: 3 },
      toolResults: [{ toolName: 'read_file', content: { path: 'a.md' } }],
    })).toMatchObject({
      events: [],
      hasVisibleContent: false,
      tokenUsage: { input: 10, output: 3 },
      stepCount: 1,
    });

    reducer.handle({
      type: 'turn_end',
      toolResults: [{ toolName: 'read_file', content: { path: 'a.md' } }],
    });

    const third = reducer.handle({
      type: 'turn_end',
      toolResults: [{ toolName: 'read_file', content: { path: 'a.md' } }],
    });
    expect(third.shouldAbort).toBe(true);
    expect(third.steerMessage).toContain('loop');
  });

  it('captures model errors from agent_end events', () => {
    const reducer = createMindosAgentEventReducer({ stepLimit: 20 });
    const result = reducer.handle({
      type: 'agent_end',
      messages: [
        { role: 'assistant', stopReason: 'error', errorMessage: 'model failed' },
      ],
    });

    expect(result).toEqual({
      events: [],
      hasVisibleContent: false,
      lastModelError: 'model failed',
    });
    expect(reducer.lastModelError).toBe('model failed');
  });

  it('sanitizes large tool payloads before streaming to clients', () => {
    expect(sanitizeToolArgs('write_file', { path: 'a.md', content: 'x'.repeat(201) })).toEqual({
      path: 'a.md',
      content: '[201 chars]',
    });
    expect(sanitizeToolArgs('batch_create_files', {
      files: [
        { path: 'a.md', content: 'secret', description: 'A' },
        { path: 'b.md', content: 'secret' },
      ],
    })).toEqual({
      files: [
        { path: 'a.md', description: 'A' },
        { path: 'b.md' },
      ],
    });
  });

  it('redacts secrets from tool args and outputs before streaming to clients', () => {
    expect(sanitizeToolArgs('call_api', {
      headers: { Authorization: 'Bearer sk-test-secret-1234567890' },
      apiKey: 'sk-test-secret-abcdefghijkl',
      url: 'https://example.test/hook?access_token=abc123secret',
      nested: [{ token: 'plain-token-secret' }],
    })).toEqual({
      headers: { Authorization: '[redacted]' },
      apiKey: '[redacted]',
      url: 'https://example.test/hook?access_token=[redacted]',
      nested: [{ token: '[redacted]' }],
    });

    expect(sanitizeToolArgs('bash', 'curl -H "Authorization: Bearer sk-live-secret-1234567890" https://example.test'))
      .toBe('curl -H "Authorization: Bearer [redacted]" https://example.test');
    expect(sanitizeToolOutput('token=abc123secret\nsk-live-secret-1234567890'))
      .toBe('token=[redacted]\n[redacted]');
  });

  it('normalizes ask step limits without Web dependencies', () => {
    expect(normalizeMindosAgentStepLimit({})).toBe(20);
    expect(normalizeMindosAgentStepLimit({ agentMaxSteps: 50 })).toBe(50);
    expect(normalizeMindosAgentStepLimit({ requestedMaxSteps: -1 })).toBe(1);
    expect(normalizeMindosAgentStepLimit({ requestedMaxSteps: 5000 })).toBe(999);
  });

  it('resolves agent timeout with a safe default for invalid environment values', () => {
    expect(resolveMindosAgentTimeoutMs()).toBe(600_000);
    expect(resolveMindosAgentTimeoutMs('1200')).toBe(1200);
    expect(resolveMindosAgentTimeoutMs('1200ms')).toBe(1200);
    expect(resolveMindosAgentTimeoutMs('bad')).toBe(600_000);
    expect(resolveMindosAgentTimeoutMs('-1')).toBe(600_000);
  });

  it('expands directory attachments with a stable limit', () => {
    expect(expandMindosAgentAttachedFiles(['Space/', 'loose.md'], () => [
      'Space/a.md',
      'Space/b.md',
      'Other/c.md',
    ], 1)).toEqual(['Space/a.md', 'loose.md']);
  });

  it('loads attached and current file context with validation and dedupe', () => {
    const loaded = loadMindosAgentFileContext(['a.md', 'a.md', 'too-big.md'], 'current.md', {
      readFile: (filePath) => `content:${filePath}`,
      truncate: (content) => content.slice(0, 20),
      validateFileSize: (filePath, cumulativeSize) => {
        if (filePath === 'too-big.md') return { valid: false, newCumulativeSize: cumulativeSize, error: 'too big' };
        return { valid: true, newCumulativeSize: cumulativeSize + 1 };
      },
    });

    expect(loaded.contextParts).toEqual([
      '### Attached file from the MindOS knowledge base: a.md\n\ncontent:a.md',
      '### Current file from the MindOS knowledge base: current.md\n\ncontent:current.md',
    ]);
    expect(loaded.failedFiles).toEqual(['too-big.md']);
    expect(loaded.mode).toBe('full');
    expect(loaded.fileReferences).toEqual([
      expect.objectContaining({ path: 'a.md', label: 'attached', contentHash: expect.any(String), size: 'content:a.md'.length }),
      { path: 'too-big.md', label: 'attached' },
      expect.objectContaining({ path: 'current.md', label: 'current', contentHash: expect.any(String), size: 'content:current.md'.length }),
    ]);
  });

  it('creates uploaded file context and safe JSON objects', () => {
    expect(createMindosUploadedFileParts([
      { name: 'a.txt', content: 'hello' },
      { name: 'b.txt', content: 'x'.repeat(12) },
      { name: 1, content: 'ignored' },
    ], { maxBytes: 10 })).toEqual([
      '### a.txt\n\nhello',
      '### b.txt\n\nxxxxxxxxxx\n\n[...truncated]',
    ]);

    expect(safeParseMindosJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(safeParseMindosJsonObject('bad')).toEqual({});
    expect(dirnameOfMindosPath('Space/note.md')).toBe('Space');
    expect(dirnameOfMindosPath('note.md')).toBeNull();
  });

  it('builds external runtime prompts with explicit MindOS turn context', () => {
    const prompt = buildMindosExternalRuntimePrompt({
      prompt: 'Summarize the attached plan.',
      fileContext: {
        contextParts: ['### Attached file from the MindOS knowledge base: Plan.md\n\nAlpha plan'],
        failedFiles: ['Missing.md'],
      },
      uploadedParts: ['### upload.txt\n\nuploaded content'],
      recalledKnowledge: [{
        path: 'Recall.md',
        content: 'recalled content',
        startLine: 3,
        endLine: 9,
        headingPath: ['Research', 'Recall'],
      }],
    });

    expect(prompt).toContain('Summarize the attached plan.');
    expect(prompt).toContain('## MindOS Turn Context');
    expect(prompt).not.toContain('MindOS composer mode: chat');
    expect(prompt).not.toContain('Treat this as read-oriented unless the user explicitly asks you to modify files.');
    expect(prompt).not.toContain('## MindOS Chat Panel Bridge');
    expect(prompt).not.toContain('AskUserQuestion');
    expect(prompt).toContain('## Attached files from the MindOS knowledge base');
    expect(prompt).toContain('### Attached file from the MindOS knowledge base: Plan.md');
    expect(prompt).toContain('## Files uploaded by the user for this request');
    expect(prompt).toContain('### upload.txt');
    expect(prompt).toContain('## Auto-Recalled MindOS Knowledge');
    expect(prompt).toContain('### Recall.md:3-9');
    expect(prompt).toContain('Heading: Research > Recall');
    expect(prompt).toContain('These attached files could not be loaded: Missing.md');
  });

  it('owns ask retry classification and backoff policy', () => {
    expect(isMindosTransientError(new Error('Request timeout after 30s'))).toBe(true);
    expect(isMindosTransientError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isMindosTransientError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isMindosTransientError(new Error('Invalid API key'))).toBe(false);

    expect(isMindosRetryableError(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isMindosRetryableError(new Error('Unauthorized'), 401)).toBe(false);
    expect(isMindosRetryableError(new Error('fetch failed'))).toBe(true);
    expect(mindosRetryDelay(0)).toBe(1000);
    expect(mindosRetryDelay(-1)).toBe(500);
    expect(mindosRetryDelay(100)).toBe(10000);
  });

  it('detects repeated agent tool loops without Web modules', () => {
    const step = (tool: string, input = '{}') => ({ tool, input });
    expect(detectMindosAgentLoop([step('read'), step('read'), step('read')])).toBe(true);
    expect(detectMindosAgentLoop([step('a', '1'), step('b', '2'), step('a', '1'), step('b', '3')])).toBe(true);
    expect(detectMindosAgentLoop([step('a'), step('b'), step('c')])).toBe(false);
  });

  it('supports abortable sleep for ask retry loops', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepMindos(1, controller.signal)).rejects.toBeDefined();
  });

  it('owns ask retry execution policy for transient failures before content streams', async () => {
    const events: Array<{ type: string; message?: string }> = [];
    let attempts = 0;
    let hasContent = false;

    const result = await runMindosAgentTurnWithRetry({
      maxRetries: 3,
      hasContent: () => hasContent,
      send: (event) => events.push(event),
      sleep: async () => {},
      retryDelay: () => 1,
      execute: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('503 Service Unavailable');
        hasContent = true;
      },
    });

    expect(result).toBeNull();
    expect(attempts).toBe(3);
    expect(events).toEqual([
      { type: 'status', message: 'Request failed, retrying (1/3)...' },
      { type: 'status', message: 'Request failed, retrying (2/3)...' },
    ]);
  });

  it('does not retry ask execution after visible content has streamed', async () => {
    let attempts = 0;
    let hasContent = false;
    const events: Array<{ type: string }> = [];

    const result = await runMindosAgentTurnWithRetry({
      maxRetries: 3,
      hasContent: () => hasContent,
      send: (event) => events.push(event),
      sleep: async () => {},
      execute: async () => {
        attempts += 1;
        hasContent = true;
        throw new Error('503 Service Unavailable');
      },
    });

    expect(result?.message).toBe('503 Service Unavailable');
    expect(attempts).toBe(1);
    expect(events).toEqual([]);
  });

  it('maps ACP updates into the shared MindOS SSE event contract', () => {
    expect(mapMindosAcpUpdateToSseEvents({ type: 'text', text: 'hello' })).toEqual({
      events: [{ type: 'text_delta', delta: 'hello' }],
      hasVisibleContent: true,
    });
    expect(mapMindosAcpUpdateToSseEvents({
      type: 'tool_call',
      toolCall: {
        toolCallId: 'call-1',
        title: 'Read',
        rawInput: '{"path":"a.md"}',
      },
    })).toEqual({
      events: [{ type: 'tool_start', toolCallId: 'call-1', toolName: 'Read', args: { path: 'a.md' } }],
      hasVisibleContent: true,
    });
    expect(mapMindosAcpUpdateToSseEvents({
      type: 'tool_call_update',
      toolCall: {
        toolCallId: 'call-1',
        status: 'failed',
        rawOutput: 'boom',
      },
    })).toEqual({
      events: [{ type: 'tool_end', toolCallId: 'call-1', output: 'boom', isError: true }],
      hasVisibleContent: false,
    });
    expect(mapMindosAcpUpdateToSseEvents({
      type: 'tool_call',
      toolCall: {
        toolCallId: 'call-secret',
        title: 'HTTP',
        rawInput: '{"headers":{"Authorization":"Bearer sk-secret-1234567890"},"url":"https://x.test/?token=abc123"}',
      },
    })).toEqual({
      events: [{
        type: 'tool_start',
        toolCallId: 'call-secret',
        toolName: 'HTTP',
        args: {
          headers: { Authorization: '[redacted]' },
          url: 'https://x.test/?token=[redacted]',
        },
      }],
      hasVisibleContent: true,
    });
    expect(mapMindosAcpUpdateToSseEvents({
      type: 'tool_call_update',
      toolCall: {
        toolCallId: 'call-secret',
        status: 'completed',
        rawOutput: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
      },
    })).toEqual({
      events: [{ type: 'tool_end', toolCallId: 'call-secret', output: 'Authorization: Bearer [redacted]', isError: false }],
      hasVisibleContent: false,
    });
    expect(mapMindosAcpUpdateToSseEvents({ type: 'error', error: 'bad' }, { suppressErrors: true })).toEqual({
      events: [],
      hasVisibleContent: false,
    });
  });

  it('owns cached proxy fallback execution policy', async () => {
    const events: Array<{ type: string; message?: string }> = [];
    let fallbackRuns = 0;

    const handled = await runMindosPiAgentTurnProxyFallback({
      phase: 'before-stream',
      provider: 'openai',
      baseUrl: 'https://proxy.example/v1',
      compatMode: 'non-streaming',
      send: (event) => events.push(event),
      messages: {
        proxyCompatMode: 'proxy mode',
        proxyCompatFailed: (message) => `failed: ${message}`,
        proxyCompatDetecting: 'detecting',
        proxyCompatAlsoFailed: (message) => `also failed: ${message}`,
      },
      runFallback: async () => { fallbackRuns += 1; },
    });

    expect(handled).toBe(true);
    expect(fallbackRuns).toBe(1);
    expect(events).toEqual([
      { type: 'status', message: 'proxy mode' },
      { type: 'done' },
    ]);
  });

  it('owns empty OpenAI-compatible fallback detection and compat cache write', async () => {
    const events: Array<{ type: string; message?: string }> = [];
    let cachedKey = '';

    const handled = await runMindosPiAgentTurnProxyFallback({
      phase: 'after-stream',
      provider: 'openai',
      baseUrl: 'https://proxy.example/v1',
      effectiveBaseUrlKey: 'https://proxy.example/v1',
      hasContent: false,
      lastModelError: 'stream failed',
      send: (event) => events.push(event),
      writeCompat: (key, mode) => { cachedKey = `${key}:${mode}`; },
      messages: {
        proxyCompatMode: 'proxy mode',
        proxyCompatFailed: (message) => `failed: ${message}`,
        proxyCompatDetecting: 'detecting',
        proxyCompatAlsoFailed: (message) => `also failed: ${message}`,
      },
      runFallback: async () => {},
    });

    expect(handled).toBe(true);
    expect(cachedKey).toBe('https://proxy.example/v1:non-streaming');
    expect(events).toEqual([
      { type: 'status', message: 'detecting' },
      { type: 'done' },
    ]);
  });

  it('reports non-OpenAI model errors without running proxy fallback', async () => {
    const events: Array<{ type: string; message?: string }> = [];
    let fallbackRuns = 0;

    const handled = await runMindosPiAgentTurnProxyFallback({
      phase: 'after-stream',
      provider: 'anthropic',
      hasContent: false,
      lastModelError: 'model failed',
      send: (event) => events.push(event),
      messages: {
        proxyCompatMode: 'proxy mode',
        proxyCompatFailed: (message) => `failed: ${message}`,
        proxyCompatDetecting: 'detecting',
        proxyCompatAlsoFailed: (message) => `also failed: ${message}`,
      },
      runFallback: async () => { fallbackRuns += 1; },
    });

    expect(handled).toBe(true);
    expect(fallbackRuns).toBe(0);
    expect(events).toEqual([{ type: 'error', message: 'model failed' }]);
  });

  it('owns OpenAI-compatible endpoint candidate construction', () => {
    expect(buildMindosCompatEndpointCandidates(
      'https://proxy.example',
      '/chat/completions',
      'openai-completions',
    )).toEqual([
      'https://proxy.example/chat/completions',
      'https://proxy.example/v1/chat/completions',
    ]);
    expect(buildMindosCompatEndpointCandidates(
      'https://proxy.example/v1/',
      'models',
      'openai-completions',
    )).toEqual(['https://proxy.example/v1/models']);
    expect(buildMindosCompatEndpointCandidates(
      'https://proxy.example',
      '/messages',
      'custom-api',
    )).toEqual(['https://proxy.example/messages']);
  });

  it('converts pi-agent history into OpenAI-compatible messages', () => {
    expect(mindosPiMessagesToOpenAI([
      { role: 'system', content: 'skip' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Use tool' },
          { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.md' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'contents' }],
      },
    ])).toEqual([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: 'Use tool',
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.md"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'contents' },
    ]);
  });

  it('reassembles streaming OpenAI chunks for fallback execution', () => {
    const result = reassembleMindosOpenAISse([
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"a.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ].join('\n'));

    expect(result).toEqual({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Hello',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.md"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    });
  });

  it('normalizes JSON chunk-shaped responses for OpenAI-compatible fallback execution', () => {
    const result = parseMindosOpenAICompatResponse(JSON.stringify({
      choices: [{
        delta: {
          role: 'assistant',
          content: 'Chunk-style JSON',
          tool_calls: [{
            id: 'call-json',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"b.md"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }));

    expect(result).toEqual({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Chunk-style JSON',
          tool_calls: [{
            id: 'call-json',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"b.md"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    });
  });

  it('runs the OpenAI-compatible non-streaming fallback loop from product session', async () => {
    const events: Array<{ type: string; delta?: string; toolCallId?: string; toolName?: string; output?: string; isError?: boolean }> = [];
    const calls: Array<{ url: string; body: any }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.md"}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: { role: 'assistant', content: 'Done' },
          finish_reason: 'stop',
        }],
      }), { status: 200 });
    };

    await runMindosNonStreamingFallback({
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'key',
      model: 'model',
      systemPrompt: 'system',
      historyMessages: [],
      userContent: 'read it',
      tools: [{
        name: 'read_file',
        description: 'Read file',
        parameters: { type: 'object' },
        execute: async (_toolCallId, _args, _signal, onUpdate) => {
          onUpdate?.({ content: [{ type: 'text', text: 'Reading file...' }] });
          return { content: [{ type: 'text', text: 'contents' }] };
        },
      }],
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      maxSteps: 3,
      fetch: fetchImpl,
      chunkDelayMs: 0,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://proxy.example/v1/chat/completions');
    expect(calls[0]?.body.stream).toBe(false);
    expect(calls[1]?.body.stream).toBe(false);
    expect(calls[1]?.body.messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'read it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.md"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'contents' },
    ]);
    expect(events).toEqual([
      { type: 'tool_start', toolCallId: 'call-1', toolName: 'read_file', args: { path: 'a.md' } },
      { type: 'tool_delta', toolCallId: 'call-1', toolName: 'read_file', delta: 'Reading file...' },
      { type: 'tool_end', toolCallId: 'call-1', toolName: 'read_file', output: 'contents', isError: false },
      { type: 'text_delta', delta: 'Done' },
    ]);
  });

  it('keeps non-streaming fallback transport on stream:false while accepting proxy SSE responses', async () => {
    const events: Array<{ type: string; delta?: string }> = [];
    const calls: Array<{ body: any }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response([
        'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":"Proxy "},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":"SSE"},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join('\n'), { status: 200 });
    };

    await runMindosNonStreamingFallback({
      baseUrl: 'https://proxy.example',
      apiKey: 'key',
      model: 'model',
      systemPrompt: 'system',
      historyMessages: [],
      userContent: 'hello',
      tools: [],
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      maxSteps: 1,
      fetch: fetchImpl,
      chunkDelayMs: 0,
    });

    expect(calls[0]?.body.stream).toBe(false);
    expect(events).toEqual([{ type: 'text_delta', delta: 'Proxy SSE' }]);
  });

  it('can explicitly request streaming transport while keeping MindOS delivery events stable', async () => {
    const events: Array<{ type: string; delta?: string }> = [];
    const calls: Array<{ body: any }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({
        choices: [{
          message: { role: 'assistant', content: 'Streaming requested, JSON returned' },
          finish_reason: 'stop',
        }],
      }), { status: 200 });
    };

    await runMindosOpenAICompatFallback({
      baseUrl: 'https://proxy.example',
      apiKey: 'key',
      model: 'model',
      systemPrompt: 'system',
      historyMessages: [],
      userContent: 'hello',
      tools: [],
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      maxSteps: 1,
      fetch: fetchImpl,
      chunkDelayMs: 0,
      requestStream: true,
    });

    expect(calls[0]?.body.stream).toBe(true);
    expect(events).toEqual([{ type: 'text_delta', delta: 'Streaming requested, JSON returned' }]);
  });

  it('keeps Pi resource loading on projectRoot while executing the session in workDir', async () => {
    const captured: {
      resourceCwd?: string;
      sessionCwd?: string;
      extensionCwd?: unknown;
      settings?: unknown;
    } = {};
    const extensionTool = {
      name: 'capture_context',
      description: 'Capture extension context',
      execute: async (
        _toolCallId: string,
        _params: unknown,
        _signal: AbortSignal | undefined,
        _onUpdate: ((update: unknown) => void) | undefined,
        ctx: Record<string, unknown>,
      ) => {
        captured.extensionCwd = ctx.cwd;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const resourceLoader = {
      reload: async () => {},
      getSkills: () => ({ skills: [] }),
      getExtensions: () => ({
        extensions: [{
          path: '/ext/context.ts',
          tools: new Map<string, unknown>([
            ['capture_context', { definition: extensionTool }],
          ]),
        }],
        errors: [],
      }),
    };
    const session = {
      subscribe: () => {},
      prompt: async () => {},
      steer: async () => {},
      abort: async () => {},
    };

    const runtime = await createMindosPiAgentRuntime({
      messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      workDir: '/repo/app',
      agentConfig: {},
      serverSettings: {},
      bashTool: { name: 'bash' },
      services: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
        createAuthStorage: () => ({ setRuntimeApiKey: () => {} }),
        createModelRegistry: () => ({ registry: true }),
        createSettingsManager: (settings) => {
          captured.settings = settings;
          return { settings };
        },
        createSessionManager: () => ({ appendMessage: () => {} }),
        createResourceLoader: (config) => {
          captured.resourceCwd = config.cwd;
          return resourceLoader;
        },
        convertToLlm: (messages) => [...messages],
        createAgentSession: async (config) => {
          captured.sessionCwd = config.cwd;
          return { session };
        },
      },
    });

    const tool = runtime.fallbackTools.find((item) => item.name === 'capture_context');
    expect(tool).toBeTruthy();
    await tool!.execute('tool-1', {}, undefined, undefined);

    expect(captured.resourceCwd).toBe('/repo');
    expect(captured.sessionCwd).toBe('/repo/app');
    expect(captured.extensionCwd).toBe('/repo/app');
    expect(captured.settings).toMatchObject({ compaction: { enabled: false } });
  });

  it('runs extension-registered tools in the non-streaming fallback with headless context', async () => {
    const captured: {
      params?: unknown;
      ctx?: Record<string, unknown>;
      toolCallId?: string;
    } = {};
    const webSearchTool = {
      name: 'web_search',
      description: 'Search the web',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      prepareArguments: (args: unknown) => ({
        ...(typeof args === 'object' && args ? args as Record<string, unknown> : {}),
        query: String(typeof args === 'object' && args ? (args as Record<string, unknown>).query ?? '' : '').trim(),
        workflow: 'none',
      }),
      execute: async (
        toolCallId: string,
        params: unknown,
        _signal: AbortSignal | undefined,
        onUpdate: ((update: unknown) => void) | undefined,
        ctx: Record<string, unknown>,
      ) => {
        captured.toolCallId = toolCallId;
        captured.params = params;
        captured.ctx = ctx;
        onUpdate?.({ content: [{ type: 'text', text: 'Searching pi.dev...' }] });
        return { content: [{ type: 'text', text: 'pi-web-access result' }] };
      },
    };
    const duplicateReadTool = {
      name: 'read_file',
      description: 'Extension read should be used by fallback',
      execute: async () => ({ content: [{ type: 'text', text: 'extension read' }] }),
    };
    const resourceLoader = {
      reload: async () => {},
      getSkills: () => ({ skills: [] }),
      getExtensions: () => ({
        extensions: [{
          path: '/ext/pi-web-access.ts',
          tools: new Map<string, unknown>([
            ['read_file', { definition: duplicateReadTool }],
            ['web_search', { definition: webSearchTool }],
          ]),
        }],
        errors: [],
      }),
    };
    const session = {
      subscribe: () => {},
      prompt: async () => {},
      steer: async () => {},
      abort: async () => {},
    };

    const runtime = await createMindosPiAgentRuntime({
      messages: [{ role: 'user', content: 'search web', timestamp: 1 }],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      agentConfig: {},
      serverSettings: {},
      bashTool: { name: 'bash' },
      services: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
        createAuthStorage: () => ({ setRuntimeApiKey: () => {} }),
        createModelRegistry: () => ({ registry: true }),
        createSettingsManager: (settings) => ({ settings }),
        createSessionManager: () => ({ appendMessage: () => {} }),
        createResourceLoader: () => resourceLoader,
        convertToLlm: (messages) => [...messages],
        createAgentSession: async () => ({ session }),
      },
    });

    expect(runtime.fallbackTools.map((tool) => tool.name)).toEqual(['read_file', 'web_search']);
    await expect(runtime.fallbackTools.find((tool) => tool.name === 'read_file')?.execute(
      'call-read',
      {},
      undefined,
      undefined,
    )).resolves.toEqual({ content: [{ type: 'text', text: 'extension read' }] });

    const events: Array<{ type: string; delta?: string; toolCallId?: string; toolName?: string; output?: string; isError?: boolean; args?: unknown }> = [];
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call-search',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":" pi-web-access "}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: { role: 'assistant', content: 'Done' },
          finish_reason: 'stop',
        }],
      }), { status: 200 });
    };

    await runMindosNonStreamingFallback({
      baseUrl: 'https://proxy.example/v1',
      apiKey: runtime.apiKey,
      model: runtime.modelName,
      systemPrompt: runtime.systemPrompt,
      historyMessages: runtime.llmHistoryMessages,
      userContent: runtime.lastUserContent,
      tools: runtime.fallbackTools,
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      maxSteps: 3,
      fetch: fetchImpl,
      chunkDelayMs: 0,
    });

    const firstCallTools = calls[0]?.body.tools as Array<{ function?: { name?: string } }>;
    expect(firstCallTools.map((tool) => tool.function?.name)).toContain('web_search');
    expect(captured.toolCallId).toBe('call-search');
    expect(captured.params).toEqual({ query: 'pi-web-access', workflow: 'none' });
    expect(captured.ctx).toMatchObject({
      cwd: '/mind',
      hasUI: false,
      model: { id: 'model-object' },
      modelRegistry: { registry: true },
    });
    expect(events).toEqual([
      { type: 'tool_start', toolCallId: 'call-search', toolName: 'web_search', args: { query: ' pi-web-access ' } },
      { type: 'tool_delta', toolCallId: 'call-search', toolName: 'web_search', delta: 'Searching pi.dev...' },
      { type: 'tool_end', toolCallId: 'call-search', toolName: 'web_search', output: 'pi-web-access result', isError: false },
      { type: 'text_delta', delta: 'Done' },
    ]);
  });

  it('owns ACP agent session lifecycle and update mapping', async () => {
    const events: Array<{ type: string; delta?: string }> = [];
    const closed: string[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      hasContent: () => events.length > 0,
      send: (event) => events.push(event),
      createSession: async (agentId, options) => ({ id: `${agentId}:${options.cwd}` }),
      promptStream: async (_sessionId, _prompt, onUpdate) => {
        onUpdate({ type: 'text', text: 'hi' });
      },
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
    });

    expect(result.error).toBeUndefined();
    expect(events).toEqual([
      { type: 'text_delta', delta: 'hi' },
      { type: 'done' },
    ]);
    expect(closed).toEqual(['agent-1:/mind']);
  });

  it('retries ACP sessions before content and always closes failed sessions', async () => {
    const events: Array<{ type: string; message?: string; delta?: string }> = [];
    const closed: string[] = [];
    let attempts = 0;

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      maxRetries: 2,
      hasContent: () => events.some((event) => event.type === 'text_delta'),
      send: (event) => events.push(event),
      createSession: async () => {
        attempts += 1;
        return { id: `session-${attempts}` };
      },
      promptStream: async (_sessionId, _prompt, onUpdate) => {
        if (attempts === 1) throw new Error('503 Service Unavailable');
        onUpdate({ type: 'text', text: 'ok' });
      },
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
      retryDelay: () => 1,
    });

    expect(result.error).toBeUndefined();
    expect(attempts).toBe(2);
    expect(closed).toEqual(['session-1', 'session-2']);
    expect(events).toEqual([
      { type: 'status', message: 'Request failed, retrying (1/2)...' },
      { type: 'text_delta', delta: 'ok' },
      { type: 'done' },
    ]);
  });

  it('cancels the active ACP prompt on abort and still closes the session', async () => {
    const controller = new AbortController();
    const events: Array<{ type: string; message?: string }> = [];
    const cancelled: string[] = [];
    const closed: string[] = [];
    let attempts = 0;

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      maxRetries: 3,
      signal: controller.signal,
      hasContent: () => false,
      send: (event) => events.push(event),
      createSession: async () => {
        attempts += 1;
        return { id: 'session-1' };
      },
      promptStream: async () => {
        controller.abort(new DOMException('The operation was aborted.', 'AbortError'));
        await new Promise(() => {});
      },
      cancelPrompt: async (sessionId) => { cancelled.push(sessionId); },
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
      retryDelay: () => 1,
    });

    expect(result.error?.name).toBe('AbortError');
    expect(attempts).toBe(1);
    expect(cancelled).toEqual(['session-1']);
    expect(closed).toEqual(['session-1']);
    expect(events).toEqual([
      { type: 'error', message: 'ACP Agent Error: The operation was aborted.' },
    ]);
  });

  it('owns pi-agent turn session subscription, prompt execution, and completion', async () => {
    const events: Array<{ type: string; delta?: string }> = [];
    let subscribed: ((event: unknown) => void) | undefined;
    let tokenUsage = '';

    await runMindosPiAgentTurnSession({
      session: {
        subscribe: (callback) => { subscribed = callback; },
        prompt: async () => {
          subscribed?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } });
          subscribed?.({ type: 'turn_end', usage: { inputTokens: 10, outputTokens: 2 } });
        },
        steer: async () => {},
        abort: async () => {},
      },
      prompt: 'hello',
      stepLimit: 5,
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      provider: 'anthropic',
      runFallback: async () => {},
      proxyMessages: {
        proxyCompatMode: 'proxy mode',
        proxyCompatDetecting: 'detecting',
        proxyCompatFailed: (message) => `failed: ${message}`,
        proxyCompatAlsoFailed: (message) => `also failed: ${message}`,
      },
      onTokens: (input, output) => { tokenUsage = `${input}:${output}`; },
      sleep: async () => {},
    });

    expect(tokenUsage).toBe('10:2');
    expect(events).toEqual([
      { type: 'text_delta', delta: 'hi' },
      { type: 'done' },
    ]);
  });

  it('aborts the active pi-agent session when the request signal aborts', async () => {
    const controller = new AbortController();
    let resolvePromptStarted!: () => void;
    const promptStarted = new Promise<void>((resolve) => { resolvePromptStarted = resolve; });
    const aborts: string[] = [];

    const pending = runMindosPiAgentTurnSession({
      session: {
        subscribe: () => {},
        prompt: async () => {
          resolvePromptStarted();
          await new Promise(() => {});
        },
        steer: async () => {},
        abort: async () => { aborts.push('abort'); },
      },
      prompt: 'hello',
      stepLimit: 5,
      send: () => {},
      signal: controller.signal,
      provider: 'anthropic',
      runFallback: async () => {},
      proxyMessages: {
        proxyCompatMode: 'proxy mode',
        proxyCompatDetecting: 'detecting',
        proxyCompatFailed: (message) => `failed: ${message}`,
        proxyCompatAlsoFailed: (message) => `also failed: ${message}`,
      },
      sleep: async () => {},
    });

    await promptStarted;
    controller.abort(new DOMException('The operation was aborted.', 'AbortError'));

    await expect(pending).rejects.toThrow('The operation was aborted.');
    expect(aborts).toEqual(['abort']);
  });

  it('uses cached proxy fallback before running pi-agent prompt', async () => {
    const events: Array<{ type: string; message?: string }> = [];
    let promptRuns = 0;
    let fallbackRuns = 0;

    await runMindosPiAgentTurnSession({
      session: {
        subscribe: () => {},
        prompt: async () => { promptRuns += 1; },
        steer: async () => {},
        abort: async () => {},
      },
      prompt: 'hello',
      stepLimit: 5,
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      provider: 'openai',
      baseUrl: 'https://proxy.example/v1',
      compatMode: 'non-streaming',
      runFallback: async () => { fallbackRuns += 1; },
      proxyMessages: {
        proxyCompatMode: 'proxy mode',
        proxyCompatDetecting: 'detecting',
        proxyCompatFailed: (message) => `failed: ${message}`,
        proxyCompatAlsoFailed: (message) => `also failed: ${message}`,
      },
      sleep: async () => {},
    });

    expect(promptRuns).toBe(0);
    expect(fallbackRuns).toBe(1);
    expect(events).toEqual([
      { type: 'status', message: 'proxy mode' },
      { type: 'done' },
    ]);
  });

  it('owns pi-coding-agent runtime initialization order through injected adapters', async () => {
    const calls: string[] = [];
    const appendedMessages: unknown[] = [];
    let capturedSystemPrompt = '';
    let capturedSystemPromptOverride: ((base?: string) => string | undefined) | null = null;
    const extensionReadTool = { name: 'read_file', execute: async () => ({ content: [{ type: 'text', text: 'extension' }] }) };
    const extensionWebTool = {
      name: 'web_search',
      description: 'Search the web',
      parameters: { type: 'object' },
      execute: async () => ({ content: [{ type: 'text', text: 'web' }] }),
    };
    const resourceLoader = {
      reload: async () => { calls.push('resource.reload'); },
      getSkills: () => ({
        skills: [
          { name: 'mindos', disableModelInvocation: false },
          { name: 'third-party', disableModelInvocation: false },
          { name: 'disabled-skill', disableModelInvocation: false },
        ],
      }),
      getExtensions: () => ({
        extensions: [{
          path: '/ext/web.ts',
          tools: new Map<string, unknown>([
            ['read_file', { definition: extensionReadTool }],
            ['web_search', { definition: extensionWebTool }],
          ]),
        }],
        errors: [],
      }),
    };
    const sessionManager = {
      appendMessage: (message: unknown) => {
        calls.push(`session.append:${appendedMessages.length}`);
        appendedMessages.push(message);
      },
    };
    const session = {
      subscribe: () => {},
      prompt: async () => {},
      steer: async () => {},
      abort: async () => {},
    };

    const runtime = await createMindosPiAgentRuntime({
      messages: [
        { role: 'user', content: 'hello', timestamp: 1 },
        { role: 'assistant', content: 'hi', timestamp: 2 },
        { role: 'user', content: 'use skill', timestamp: 3, skillName: 'third-party', images: [{ type: 'image', data: 'img', mimeType: 'image/png' }] },
      ],
      systemPrompt: 'base prompt',
      providerOverride: 'openai',
      modelOverride: 'gpt-test',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      agentConfig: { enableThinking: true, thinkingBudget: 3000, contextStrategy: 'off' },
      serverSettings: { disabledSkills: ['disabled-skill'] },
      additionalSkillPaths: ['/skills'],
      additionalExtensionPaths: ['/ext'],
      bashTool: { name: 'bash' },
      services: {
        resolveModelConfig: (input) => {
          calls.push(`model:${input.providerOverride}:${input.modelOverride}:${input.hasImages}`);
          return {
            model: { id: 'model-object' },
            modelName: 'gpt-test',
            apiKey: 'key',
            provider: 'anthropic',
            baseUrl: 'https://example.test/v1',
          };
        },
        toRuntimeProvider: (provider) => `runtime:${provider}`,
        createAuthStorage: () => ({
          setRuntimeApiKey: (provider, apiKey) => calls.push(`auth:${provider}:${apiKey}`),
        }),
        createModelRegistry: () => ({ registry: true }),
        createSettingsManager: (settings) => {
          calls.push(`settings:${JSON.stringify(settings)}`);
          return { settings };
        },
        createSessionManager: () => sessionManager,
        createResourceLoader: (config) => {
          calls.push(`loader:${config.cwd}:${config.additionalSkillPaths.join(',')}:${config.additionalExtensionPaths.join(',')}`);
          capturedSystemPrompt = config.systemPrompt;
          capturedSystemPromptOverride = config.systemPromptOverride ?? null;
          expect(config.skillsOverride({
            skills: [{ name: 'mindos' }, { name: 'third-party' }],
          }).skills).toEqual([{ name: 'third-party' }]);
          return resourceLoader;
        },
        convertToLlm: (messages) => {
          calls.push(`convert:${messages.length}`);
          return messages.map((message, index) => ({ index, message }));
        },
        createAgentSession: async (config) => {
          // `tools` on pi-coding-agent ≥0.62 is a string-name allowlist; passing
          // anything there silently filters out every other tool source, so the
          // contract is: no allowlist, builtins off, bash exposed as customTool.
          const allowlist = 'tools' in config ? 'ALLOWLIST' : 'no-allowlist';
          const customToolNames = ((config.customTools ?? []) as Array<{ name?: string }>)
            .map((tool) => tool.name)
            .join(',');
          calls.push(`agent:${config.cwd}:${config.thinkingLevel}:${allowlist}:${config.noTools}:${customToolNames}`);
          return { session };
        },
        generateSkillsXml: (skills) => `<skills>${skills.map((skill) => skill.name).join(',')}</skills>`,
      },
    });

    expect(runtime.lastUserContent).toBe('use skill');
    expect(runtime.lastUserImages).toEqual([{ type: 'image', data: 'img', mimeType: 'image/png' }]);
    expect(runtime.modelName).toBe('gpt-test');
    expect(runtime.provider).toBe('anthropic');
    expect(runtime.fallbackTools.map((tool) => tool.name)).toEqual(['read_file', 'web_search']);
    await expect(runtime.fallbackTools.find((tool) => tool.name === 'read_file')?.execute(
      'call-read',
      {},
      undefined,
      undefined,
    )).resolves.toEqual({ content: [{ type: 'text', text: 'extension' }] });
    expect(runtime.fallbackTools.find((tool) => tool.name === 'web_search')).toMatchObject({
      name: 'web_search',
      description: 'Search the web',
      parameters: { type: 'object' },
    });
    expect(runtime.lastUserSkillName).toBe('third-party');
    expect(runtime.systemPrompt).toContain('<skills>third-party</skills>');
    expect(runtime.systemPrompt).toContain('## MindOS Pi Runtime Tools');
    expect(runtime.systemPrompt).toContain('- web_search [web]');
    expect(runtime.systemPrompt).toContain('- read_file [web]');
    expect(runtime.systemPrompt).toContain('- bash [mindos-runtime]');
    expect(runtime.systemPrompt).not.toContain('load_skill("third-party")');
    expect(runtime.systemPrompt).not.toContain('## Active Skill Request');
    expect(capturedSystemPrompt).toBe('base prompt');
    // The streaming session reads its system prompt through the resource
    // loader's override on reload — the runtime skill index must arrive
    // there, not just in runtime.systemPrompt (which only the non-streaming
    // fallback uses). The active skill request is turn-local context and stays
    // out of the system prompt.
    expect(capturedSystemPromptOverride).not.toBeNull();
    const effectiveSessionPrompt = capturedSystemPromptOverride!('base prompt');
    expect(effectiveSessionPrompt).toContain('base prompt');
    expect(effectiveSessionPrompt).toContain('<skills>third-party</skills>');
    expect(effectiveSessionPrompt).toContain('## MindOS Pi Runtime Tools');
    expect(effectiveSessionPrompt).toContain('- web_search [web]');
    expect(effectiveSessionPrompt).not.toContain('load_skill("third-party")');
    expect(effectiveSessionPrompt).not.toContain('## Active Skill Request');
    expect(effectiveSessionPrompt).toBe(runtime.systemPrompt);
    expect(appendedMessages).toEqual([
      { index: 0, message: expect.objectContaining({ role: 'user' }) },
      { index: 1, message: expect.objectContaining({ role: 'assistant' }) },
    ]);
    expect(calls).toEqual([
      'model:openai:gpt-test:true',
      'convert:2',
      'auth:runtime:anthropic:key',
      'settings:{"enableSkillCommands":true,"compaction":{"enabled":false},"thinkingBudgets":{"medium":3000}}',
      'loader:/repo:/skills:/ext',
      'resource.reload',
      'resource.reload',
      'session.append:0',
      'session.append:1',
      'agent:/mind:medium:no-allowlist:builtin:bash',
    ]);
  });

  it('returns deduplicated pi extension load errors for host diagnostics', async () => {
    const session = {
      subscribe: () => {},
      prompt: async () => {},
      steer: async () => {},
      abort: async () => {},
    };
    const extensionError = {
      path: '/repo/packages/web/node_modules/pi-web-access/index.ts',
      error: 'Cannot load extension',
    };
    const reportedErrors: unknown[] = [];

    const runtime = await createMindosPiAgentRuntime({
      messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      agentConfig: {},
      serverSettings: {},
      bashTool: { name: 'bash' },
      services: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
        createAuthStorage: () => ({ setRuntimeApiKey: () => {} }),
        createModelRegistry: () => ({}),
        createSettingsManager: (settings) => ({ settings }),
        createSessionManager: () => ({ appendMessage: () => {} }),
        createResourceLoader: () => ({
          reload: async () => {},
          getSkills: () => ({ skills: [] }),
          getExtensions: () => ({ extensions: [], errors: [extensionError] }),
        }),
        convertToLlm: (messages) => [...messages],
        createAgentSession: async () => ({ session }),
        onExtensionLoadErrors: (errors) => { reportedErrors.push(errors); },
      },
    });

    expect(runtime.extensionLoadErrors).toEqual([extensionError]);
    expect(reportedErrors).toEqual([[extensionError], [extensionError]]);
  });

  it('reports when pi-web-access loads without the expected web tools', async () => {
    const session = {
      subscribe: () => {},
      prompt: async () => {},
      steer: async () => {},
      abort: async () => {},
    };
    const webAccessPath = '/repo/packages/web/node_modules/pi-web-access/index.ts';

    const runtime = await createMindosPiAgentRuntime({
      messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      agentConfig: {},
      serverSettings: {},
      additionalExtensionPaths: [webAccessPath],
      bashTool: { name: 'bash' },
      services: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
        createAuthStorage: () => ({ setRuntimeApiKey: () => {} }),
        createModelRegistry: () => ({}),
        createSettingsManager: (settings) => ({ settings }),
        createSessionManager: () => ({ appendMessage: () => {} }),
        createResourceLoader: () => ({
          reload: async () => {},
          getSkills: () => ({ skills: [] }),
          getExtensions: () => ({
            extensions: [{
              path: webAccessPath,
              tools: new Map<string, unknown>([
                ['code_search', {
                  definition: {
                    name: 'code_search',
                    description: 'Search code',
                    execute: async () => ({ content: [] }),
                  },
                }],
              ]),
            }],
            errors: [],
          }),
        }),
        convertToLlm: (messages) => [...messages],
        createAgentSession: async () => ({ session }),
      },
    });

    expect(runtime.extensionLoadErrors).toEqual([{
      path: webAccessPath,
      error: 'pi-web-access did not register expected tool(s): web_search, fetch_content',
    }]);
  });

  it('keeps builtins off and registers no SDK custom tools when project bash is disabled', async () => {
    let captured: Record<string, unknown> | null = null;
    const session = {
      subscribe: () => {},
      prompt: async () => {},
      steer: async () => {},
      abort: async () => {},
    };

    await createMindosPiAgentRuntime({
      allowProjectBash: false,
      messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      agentConfig: {},
      serverSettings: {},
      bashTool: { name: 'bash' },
      services: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
        createAuthStorage: () => ({ setRuntimeApiKey: () => {} }),
        createModelRegistry: () => ({}),
        createSettingsManager: (settings) => ({ settings }),
        createSessionManager: () => ({ appendMessage: () => {} }),
        createResourceLoader: () => ({
          reload: async () => {},
          getSkills: () => ({ skills: [] }),
        }),
        convertToLlm: (messages) => [...messages],
        createAgentSession: async (config) => {
          captured = config as unknown as Record<string, unknown>;
          return { session };
        },
      },
    });

    expect(captured).not.toBeNull();
    const config = captured! as Record<string, unknown>;
    // No tool-name allowlist: it would hard-filter extension-registered KB tools.
    expect('tools' in config).toBe(false);
    expect(config.noTools).toBe('builtin');
    // request tools must NOT be re-registered as SDK customTools: by-name they
    // override the kb-extension wrappers and lose write-protection + audit log.
    expect(config.customTools).toEqual([]);
  });

  it('does not register project bash when agent prompt runs under a non-terminal permission policy', async () => {
    let captured: Record<string, unknown> | null = null;
    const session = {
      subscribe: () => {},
      prompt: async () => {},
      steer: async () => {},
      abort: async () => {},
    };

    await createMindosPiAgentRuntime({
      allowProjectBash: false,
      messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      agentConfig: {},
      serverSettings: {},
      bashTool: { name: 'bash' },
      services: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
        createAuthStorage: () => ({ setRuntimeApiKey: () => {} }),
        createModelRegistry: () => ({}),
        createSettingsManager: (settings) => ({ settings }),
        createSessionManager: () => ({ appendMessage: () => {} }),
        createResourceLoader: () => ({
          reload: async () => {},
          getSkills: () => ({ skills: [] }),
        }),
        convertToLlm: (messages) => [...messages],
        createAgentSession: async (config) => {
          captured = config as unknown as Record<string, unknown>;
          return { session };
        },
      },
    });

    expect(captured).not.toBeNull();
    const config = captured! as Record<string, unknown>;
    expect(config.noTools).toBe('builtin');
    expect(config.customTools).toEqual([]);
  });

  it('converts UI ask messages into product-owned agent history objects', () => {
    const converted = toMindosAgentMessages([
      {
        role: 'user',
        content: 'Look at this',
        timestamp: 1,
        images: [
          { type: 'image', data: 'base64', mimeType: 'image/png' },
          { type: 'image', data: '', mimeType: 'image/png' },
        ],
      },
      {
        role: 'assistant',
        content: 'I will read it',
        timestamp: 2,
        parts: [
          { type: 'text', text: 'Reading' },
          { type: 'reasoning', text: 'internal' },
          { type: 'runtime-status', runtime: 'claude', message: 'Claude Code HTTP 429; retrying (1/10).' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read_file',
            input: { path: 'a.md' },
            output: 'contents',
            state: 'done',
          },
        ],
      },
      { role: 'assistant', content: '__error__network', timestamp: 3 },
    ]);

    expect(converted).toHaveLength(3);
    expect(converted[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'image', data: 'base64', mimeType: 'image/png' },
        { type: 'text', text: 'Look at this' },
      ],
      timestamp: 1,
    });
    expect(converted[1]).toMatchObject({
      role: 'assistant',
      stopReason: 'toolUse',
      content: [
        { type: 'text', text: 'Reading' },
        { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.md' } },
      ],
    });
    expect(converted[2]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read_file',
      content: [{ type: 'text', text: 'contents' }],
      isError: false,
    });
  });
});
