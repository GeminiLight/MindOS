import type { MindOSSSEvent } from '../session/index.js';
import { redactSensitiveText } from '../session/index.js';
import {
  createClaudeCodeCliClient,
  createClaudeCodeCliStdioTransport,
  type ClaudeCodeCliClient,
  type ClaudeCodeCliPermissionMode,
  type ClaudeCodeCliPermissionPrompt,
} from './claude-code-cli.js';
import {
  createClaudeCodeSdkClient,
  isClaudeCodeSdkNativeBinaryError,
  loadClaudeCodeSdkModule,
  type ClaudeCodeSdkModule,
} from './claude-code-sdk.js';
import {
  createCodexAppServerClient,
  createCodexAppServerStdioTransport,
  mapCodexAppServerNotificationToSseEvents,
  type CodexAppServerClient,
  type CodexAppServerServerRequest,
} from './codex-app-server.js';
import { compactRuntimeFailureMessage } from './runtime-errors.js';

export type MindosNativeAgentRuntimeKind = 'codex' | 'claude';

export type MindosAgentRuntimeSelection = {
  id: string;
  name: string;
  kind: MindosNativeAgentRuntimeKind;
  externalSessionId?: string;
  binaryPath?: string;
};

export type MindosAgentRuntimeAskServices = {
  createCodexClient?(options: {
    cwd: string;
    signal?: AbortSignal;
    handleServerRequest?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown;
  }): CodexAppServerClient | Promise<CodexAppServerClient>;
  createClaudeClient?(options: { cwd: string; signal?: AbortSignal }): ClaudeCodeCliClient | Promise<ClaudeCodeCliClient>;
  createClaudeCliClient?(options: { cwd: string; signal?: AbortSignal; command?: string; env?: NodeJS.ProcessEnv }): ClaudeCodeCliClient | Promise<ClaudeCodeCliClient>;
  createClaudeSdkClient?(options: { cwd: string; signal?: AbortSignal; command: string; env?: NodeJS.ProcessEnv }): ClaudeCodeCliClient | Promise<ClaudeCodeCliClient>;
  loadClaudeSdk?(): ClaudeCodeSdkModule | Promise<ClaudeCodeSdkModule>;
  createClaudePermissionPrompt?(options: {
    cwd: string;
    signal?: AbortSignal;
  }): ClaudeCodeCliPermissionPrompt | undefined | Promise<ClaudeCodeCliPermissionPrompt | undefined>;
  requestRuntimePermission?(
    request: MindosRuntimePermissionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MindosRuntimePermissionResult>;
  requestUserQuestion?(
    request: MindosRuntimeUserQuestionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MindosRuntimeUserQuestionResult>;
};

export type MindosRuntimePermissionOption = {
  id: string;
  label: string;
  description?: string;
  intent?: 'allow' | 'deny' | 'cancel';
  scope?: 'once' | 'session' | 'always' | 'turn';
};

export type MindosRuntimePermissionRisk = {
  level: 'low' | 'medium' | 'high';
  summary: string;
  reasons?: string[];
};

export type MindosRuntimePermissionRequest = {
  runtime: 'codex' | 'claude';
  toolCallId: string;
  toolName: string;
  input: unknown;
  options: MindosRuntimePermissionOption[];
  reason?: string;
  action?: string;
  resource?: string;
  risk?: MindosRuntimePermissionRisk;
};

export type MindosRuntimePermissionResult = {
  decision: string;
  cancelled?: boolean;
  decisionLabel?: string;
  decisionIntent?: 'allow' | 'deny' | 'cancel';
  decisionScope?: 'once' | 'session' | 'always' | 'turn';
};

export type MindosRuntimeUserQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

export type MindosRuntimeUserQuestion = {
  question: string;
  header: string;
  options: MindosRuntimeUserQuestionOption[];
  multiSelect?: boolean;
};

export type MindosRuntimeUserQuestionAnswer = {
  questionIndex: number;
  question: string;
  kind: 'option' | 'custom' | 'chat' | 'multi';
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
};

export type MindosRuntimeUserQuestionRequest = {
  runtime: 'codex' | 'claude';
  toolCallId: string;
  questions: MindosRuntimeUserQuestion[];
};

export type MindosRuntimeUserQuestionResult = {
  answers: MindosRuntimeUserQuestionAnswer[];
  cancelled?: boolean;
  error?: string;
};

export type MindosAgentRuntimeAskOptions = {
  runtime: MindosAgentRuntimeSelection;
  cwd: string;
  prompt: string;
  permissionMode?: 'readonly' | 'agent';
  modelOverride?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  timeoutMs?: number;
  runtimeEnv?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  send(event: MindOSSSEvent): void;
  services?: MindosAgentRuntimeAskServices;
};

export type MindosAgentRuntimeAskResult = {
  externalSessionId?: string;
  error?: Error;
};

type CodexPendingServerRequestKind = 'permission' | 'question';

type CodexPendingServerRequest = {
  requestId: number;
  toolCallId: string;
  kind: CodexPendingServerRequestKind;
  abortController: AbortController;
  cleanup(): void;
};

type CodexPendingServerRequests = Map<string, CodexPendingServerRequest>;

type ResolvedClaudeClient = {
  client: ClaudeCodeCliClient;
  usesCliPermissionPrompt: boolean;
  source: 'sdk' | 'cli' | 'override';
};

function sendNativeRuntimeStatus(
  options: MindosAgentRuntimeAskOptions,
  runtime: MindosNativeAgentRuntimeKind,
  message: string,
): void {
  options.send({ type: 'status', visible: true, runtime, message });
}

export async function runMindosAgentRuntimeAskSession(
  options: MindosAgentRuntimeAskOptions,
): Promise<MindosAgentRuntimeAskResult> {
  const scoped = withNativeRuntimeTimeout(options);
  try {
    if (scoped.options.runtime.kind === 'claude') {
      return await runClaudeAskSession(scoped.options);
    }

    return await runCodexAskSession(scoped.options);
  } finally {
    scoped.cleanup();
  }
}

function createNativeRuntimeTimeoutError(timeoutMs: number): Error & { code: 'TIMEOUT' } {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const error = new Error(`Native runtime timed out after ${seconds}s.`) as Error & { code: 'TIMEOUT' };
  error.code = 'TIMEOUT';
  return error;
}

function isTimeoutError(value: unknown): value is Error & { code: 'TIMEOUT' } {
  return value instanceof Error && (value as { code?: unknown }).code === 'TIMEOUT';
}

function errorFromRuntimeFailure(
  error: unknown,
  signal?: AbortSignal,
  runtime?: MindosNativeAgentRuntimeKind,
): Error {
  const reason = signal?.reason;
  if (signal?.aborted && isTimeoutError(reason)) return reason;
  // Transport failures can echo stderr/env contents; redact before the
  // message reaches SSE events or persisted run ledgers.
  const rawMessage = redactSensitiveText(error instanceof Error ? error.message : String(error));
  const compactMessage = compactRuntimeFailureMessage(rawMessage, {
    runtime,
    fallback: `${runtime === 'claude' ? 'Claude Code' : 'Codex'} native runtime error.`,
  });
  const compactError = new Error(compactMessage);
  if (error instanceof Error) compactError.name = error.name;
  return compactError;
}

function throwIfNativeRuntimeTimedOut(signal?: AbortSignal): void {
  if (signal?.aborted && isTimeoutError(signal.reason)) {
    throw signal.reason;
  }
}

function abortErrorFromSignal(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(reason ? String(reason) : 'Native runtime aborted.');
}

function throwIfNativeRuntimeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortErrorFromSignal(signal);
  }
}

function settleIteratorReturn<T>(iterator: AsyncIterator<T>): void {
  const result = iterator.return?.();
  if (result && typeof (result as PromiseLike<IteratorResult<T>>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
  }
}

async function nextWithNativeRuntimeAbort<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  throwIfNativeRuntimeAborted(signal);

  const nextPromise = Promise.resolve(iterator.next());
  nextPromise.catch(() => {});
  if (!signal) return nextPromise;

  let removeAbortListener = () => {};
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(abortErrorFromSignal(signal));
    removeAbortListener = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
  });

  try {
    return await Promise.race([nextPromise, abortPromise]);
  } catch (error) {
    if (signal.aborted) {
      throw abortErrorFromSignal(signal);
    }
    throw error;
  } finally {
    removeAbortListener();
  }
}

async function* iterateWithNativeRuntimeAbort<T>(
  iterable: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncIterable<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  let completed = false;
  try {
    while (true) {
      const next = await nextWithNativeRuntimeAbort(iterator, signal);
      if (next.done) {
        completed = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!completed) {
      settleIteratorReturn(iterator);
    }
  }
}

function withNativeRuntimeTimeout(options: MindosAgentRuntimeAskOptions): {
  options: MindosAgentRuntimeAskOptions;
  cleanup(): void;
} {
  const timeoutMs = options.timeoutMs;
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { options, cleanup: () => {} };
  }

  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(options.signal?.reason ?? new Error('Native runtime aborted.'));
    }
  };
  if (options.signal?.aborted) {
    abortFromParent();
  } else {
    options.signal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(createNativeRuntimeTimeoutError(timeoutMs));
    }
  }, timeoutMs);

  return {
    options: {
      ...options,
      signal: controller.signal,
    },
    cleanup: () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function runClaudeAskSession(options: MindosAgentRuntimeAskOptions): Promise<MindosAgentRuntimeAskResult> {
  let client: ClaudeCodeCliClient | undefined;
  let sessionId = options.runtime.externalSessionId;
  const turnState = { sessionId };

  try {
    sendNativeRuntimeStatus(options, 'claude', sessionId
      ? 'Resuming Claude Code locally.'
      : 'Starting Claude Code locally.');
    const resolvedClient = await resolveClaudeClient(options);
    client = resolvedClient.client;
    try {
      sessionId = await runClaudeTurnWithClient(options, resolvedClient, turnState);
    } catch (error) {
      sessionId = turnState.sessionId;
      const err = errorFromRuntimeFailure(error, options.signal, 'claude');
      if (resolvedClient.source !== 'sdk' || !shouldFallbackFromClaudeSdkTurnError(err, options.signal)) {
        throw error;
      }

      await client.close?.();
      sendNativeRuntimeStatus(options, 'claude', `Claude Agent SDK could not start its native runtime; using Claude Code CLI fallback. ${err.message}`);
      const cliClient = await resolveClaudeCliClient(options);
      client = cliClient;
      turnState.sessionId = sessionId;
      sessionId = await runClaudeTurnWithClient(options, {
        client: cliClient,
        usesCliPermissionPrompt: true,
        source: 'cli',
      }, turnState);
    }
    throwIfNativeRuntimeTimedOut(options.signal);

    return sessionId ? { externalSessionId: sessionId } : {};
  } catch (error) {
    const err = errorFromRuntimeFailure(error, options.signal, 'claude');
    if (sessionId) {
      options.send({
        type: 'runtime_binding',
        runtime: 'claude',
        externalSessionId: sessionId,
        cwd: options.cwd,
        status: 'failed',
        reason: err.message,
      });
    }
    options.send({ type: 'error', message: `Claude Code native runtime error: ${err.message}` });
    return { error: err, ...(sessionId ? { externalSessionId: sessionId } : {}) };
  } finally {
    await client?.close?.();
  }
}

async function runClaudeTurnWithClient(
  options: MindosAgentRuntimeAskOptions,
  resolvedClient: ResolvedClaudeClient,
  state: { sessionId?: string },
): Promise<string | undefined> {
  let sessionId = state.sessionId;
  const permissionPrompt = resolvedClient.usesCliPermissionPrompt
    ? await options.services?.createClaudePermissionPrompt?.({
      cwd: options.cwd,
      signal: options.signal,
    })
    : undefined;
  const turnEvents = resolvedClient.client.startTurn({
    prompt: options.prompt,
    cwd: options.cwd,
    ...(sessionId ? { sessionId } : {}),
    ...(options.modelOverride ? { model: options.modelOverride } : {}),
    ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
    permissionMode: claudeCliPermissionModeForMindosMode(options.permissionMode),
    ...(permissionPrompt ? { permissionPrompt } : {}),
    signal: options.signal,
  });
  for await (const event of iterateWithNativeRuntimeAbort(turnEvents, options.signal)) {
    if (event.type === 'session_id') {
      sessionId = event.sessionId;
      state.sessionId = event.sessionId;
      options.send({
        type: 'runtime_binding',
        runtime: 'claude',
        externalSessionId: event.sessionId,
        cwd: options.cwd,
      });
      sendNativeRuntimeStatus(options, 'claude', 'Claude Code is connected and working in this chat.');
      continue;
    }
    options.send(event);
  }
  return sessionId;
}

function shouldFallbackFromClaudeSdkTurnError(error: Error, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return isClaudeCodeSdkNativeBinaryError(error);
}

function claudeCliPermissionModeForMindosMode(
  mode: MindosAgentRuntimeAskOptions['permissionMode'],
): ClaudeCodeCliPermissionMode {
  return mode === 'readonly' ? 'dontAsk' : 'default';
}

function codexPermissionOptionsForMindosMode(
  mode: MindosAgentRuntimeAskOptions['permissionMode'],
): { approvalPolicy?: string; sandbox?: Record<string, unknown> } {
  if (mode !== 'readonly') return {};
  return {
    approvalPolicy: 'never',
    sandbox: { mode: 'read-only' },
  };
}

async function runCodexAskSession(options: MindosAgentRuntimeAskOptions): Promise<MindosAgentRuntimeAskResult> {
  let client: CodexAppServerClient | undefined;
  let threadId = options.runtime.externalSessionId;
  const pendingServerRequests: CodexPendingServerRequests = new Map();

  try {
    sendNativeRuntimeStatus(options, 'codex', threadId
      ? 'Resuming Codex locally.'
      : 'Starting Codex locally.');
    client = await resolveCodexClient(options, async (request) => {
      return handleCodexServerRequest(request, options, pendingServerRequests);
    });
    await client.initialize({ signal: options.signal });
    const thread = threadId
      ? await client.resumeThread({ threadId }, { signal: options.signal })
      : await client.startThread({
        cwd: options.cwd,
        ...(options.modelOverride ? { model: options.modelOverride } : {}),
      }, { signal: options.signal });
    threadId = thread.threadId;
    options.send({
      type: 'runtime_binding',
      runtime: 'codex',
      externalSessionId: threadId,
      cwd: options.cwd,
    });
    sendNativeRuntimeStatus(options, 'codex', 'Codex is connected and working in this chat.');

    const abortListener = () => {
      if (threadId) void client?.interruptTurn?.({ threadId }).catch(() => {});
    };
    options.signal?.addEventListener('abort', abortListener, { once: true });
    try {
      const turnNotifications = client.startTurn({
        threadId,
        cwd: options.cwd,
        input: [{ type: 'text', text: options.prompt }],
        ...(options.modelOverride ? { model: options.modelOverride } : {}),
        ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
        ...codexPermissionOptionsForMindosMode(options.permissionMode),
        signal: options.signal,
      });
      for await (const notification of iterateWithNativeRuntimeAbort(turnNotifications, options.signal)) {
        if (notification.method === 'serverRequest/resolved') {
          abortCodexPendingServerRequest(notification.params, pendingServerRequests);
        }
        for (const event of mapCodexAppServerNotificationToSseEvents(notification)) {
          options.send(event);
        }
      }
    } finally {
      options.signal?.removeEventListener('abort', abortListener);
    }
    throwIfNativeRuntimeTimedOut(options.signal);

    return { externalSessionId: threadId };
  } catch (error) {
    const err = errorFromRuntimeFailure(error, options.signal, 'codex');
    if (threadId) {
      options.send({
        type: 'runtime_binding',
        runtime: 'codex',
        externalSessionId: threadId,
        cwd: options.cwd,
        status: 'failed',
        reason: err.message,
      });
    }
    options.send({ type: 'error', message: `Codex native runtime error: ${err.message}` });
    return { error: err, ...(threadId ? { externalSessionId: threadId } : {}) };
  } finally {
    abortAllCodexPendingServerRequests(pendingServerRequests);
    await client?.close?.();
  }
}

async function resolveCodexClient(
  options: MindosAgentRuntimeAskOptions,
  handleServerRequest?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown,
): Promise<CodexAppServerClient> {
  if (options.services?.createCodexClient) {
    return options.services.createCodexClient({ cwd: options.cwd, signal: options.signal, handleServerRequest });
  }

  return createCodexAppServerClient(
    createCodexAppServerStdioTransport({
      cwd: options.cwd,
      ...(options.runtime.binaryPath ? { command: options.runtime.binaryPath } : {}),
      ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
    }),
    { handleServerRequest },
  );
}

async function resolveClaudeClient(options: MindosAgentRuntimeAskOptions): Promise<ResolvedClaudeClient> {
  const command = requireClaudeLocalCliPath(options);

  if (options.services?.createClaudeClient) {
    return {
      client: await options.services.createClaudeClient({ cwd: options.cwd, signal: options.signal }),
      usesCliPermissionPrompt: true,
      source: 'override',
    };
  }

  try {
    return {
      client: await resolveClaudeSdkClient(options),
      usesCliPermissionPrompt: false,
      source: 'sdk',
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    sendNativeRuntimeStatus(options, 'claude', `Claude Agent SDK is unavailable; using Claude Code CLI fallback. ${err.message}`);
  }

  return {
    client: await resolveClaudeCliClient(options, command),
    usesCliPermissionPrompt: true,
    source: 'cli',
  };
}

async function resolveClaudeSdkClient(options: MindosAgentRuntimeAskOptions): Promise<ClaudeCodeCliClient> {
  const command = requireClaudeLocalCliPath(options);
  if (options.services?.createClaudeSdkClient) {
    return options.services.createClaudeSdkClient({
      cwd: options.cwd,
      signal: options.signal,
      command,
      ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
    });
  }

  const sdk = options.services?.loadClaudeSdk
    ? await options.services.loadClaudeSdk()
    : await loadClaudeCodeSdkModule();
  return createClaudeCodeSdkClient({
    sdk,
    pathToClaudeCodeExecutable: command,
    ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
    requestRuntimePermission: options.services?.requestRuntimePermission,
    requestUserQuestion: options.services?.requestUserQuestion,
  });
}

async function resolveClaudeCliClient(
  options: MindosAgentRuntimeAskOptions,
  command = requireClaudeLocalCliPath(options),
): Promise<ClaudeCodeCliClient> {
  if (options.services?.createClaudeCliClient) {
    return options.services.createClaudeCliClient({
      cwd: options.cwd,
      signal: options.signal,
      command,
      ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
    });
  }

  return createClaudeCodeCliClient(createClaudeCodeCliStdioTransport({
    command,
    ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
  }));
}

function isNativeCliBinaryPath(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.startsWith('sdk:');
}

function requireClaudeLocalCliPath(options: MindosAgentRuntimeAskOptions): string {
  if (isNativeCliBinaryPath(options.runtime.binaryPath)) return options.runtime.binaryPath;
  throw new Error('Claude Code requires a local claude executable detected by MindOS. MindOS does not bundle the Claude Agent SDK native runtime.');
}

async function handleCodexServerRequest(
  request: CodexAppServerServerRequest,
  options: MindosAgentRuntimeAskOptions,
  pendingServerRequests?: CodexPendingServerRequests,
): Promise<unknown> {
  if (isCodexUserInputRequest(request)) {
    return handleCodexUserInputRequest(request, options, pendingServerRequests);
  }

  if (!isCodexApprovalRequest(request)) {
    throw new Error(`Unhandled Codex app-server request: ${request.method}`);
  }

  const permissionRequest = buildCodexPermissionRequest(request);
  const result = await withCodexPendingServerRequest(
    request,
    {
      kind: 'permission',
      toolCallId: permissionRequest.toolCallId,
      signal: options.signal,
      pendingServerRequests,
    },
    async (signal) => (
      options.services?.requestRuntimePermission
        ? await options.services.requestRuntimePermission(permissionRequest, { signal })
        : { decision: 'cancel', cancelled: true }
    ),
  );

  if (request.method === 'item/permissions/requestApproval') {
    return codexPermissionsApprovalResult(request, result);
  }

  return {
    decision: result.cancelled ? 'cancel' : normalizeCodexApprovalDecision(result.decision),
  };
}

async function handleCodexUserInputRequest(
  request: CodexAppServerServerRequest,
  options: MindosAgentRuntimeAskOptions,
  pendingServerRequests?: CodexPendingServerRequests,
): Promise<unknown> {
  const questionRequest = buildCodexUserQuestionRequest(request);
  const result = await withCodexPendingServerRequest(
    request,
    {
      kind: 'question',
      toolCallId: questionRequest.toolCallId,
      signal: options.signal,
      pendingServerRequests,
    },
    async (signal) => (
      options.services?.requestUserQuestion
        ? await options.services.requestUserQuestion(questionRequest, { signal })
        : { answers: [], cancelled: true, error: 'no_bridge' }
    ),
  );

  if (result.cancelled) {
    return { cancelled: true, answers: [], error: result.error ?? 'cancelled' };
  }

  return {
    answers: result.answers.map((answer) => ({
      questionIndex: answer.questionIndex,
      question: answer.question,
      answer: answer.answer,
      ...(answer.selected ? { selected: answer.selected } : {}),
      ...(answer.kind ? { kind: answer.kind } : {}),
    })),
  };
}

function isCodexUserInputRequest(request: CodexAppServerServerRequest): boolean {
  return request.method === 'item/tool/requestUserInput'
    || request.method === 'tool/requestUserInput';
}

function isCodexApprovalRequest(request: CodexAppServerServerRequest): boolean {
  return request.method === 'item/commandExecution/requestApproval'
    || request.method === 'item/fileChange/requestApproval'
    || request.method === 'item/permissions/requestApproval'
    || /approval|permission/i.test(request.method);
}

async function withCodexPendingServerRequest<T>(
  request: CodexAppServerServerRequest,
  input: {
    kind: CodexPendingServerRequestKind;
    toolCallId: string;
    signal?: AbortSignal;
    pendingServerRequests?: CodexPendingServerRequests;
  },
  callback: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!input.pendingServerRequests) return callback(input.signal);

  const abortController = new AbortController();
  const abortFromParent = () => abortController.abort();
  if (input.signal?.aborted) {
    abortController.abort();
  } else {
    input.signal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const keys = codexServerRequestKeys(request);
  const pending: CodexPendingServerRequest = {
    requestId: request.id,
    toolCallId: input.toolCallId,
    kind: input.kind,
    abortController,
    cleanup: () => {
      input.signal?.removeEventListener('abort', abortFromParent);
      for (const key of keys) {
        if (input.pendingServerRequests?.get(key) === pending) {
          input.pendingServerRequests.delete(key);
        }
      }
    },
  };

  for (const key of keys) input.pendingServerRequests.set(key, pending);

  try {
    return await callback(abortController.signal);
  } finally {
    pending.cleanup();
  }
}

function abortCodexPendingServerRequest(
  params: Record<string, unknown> | undefined,
  pendingServerRequests: CodexPendingServerRequests,
): boolean {
  const keys = codexServerRequestResolvedKeys(params);
  for (const key of keys) {
    const pending = pendingServerRequests.get(key);
    if (!pending) continue;
    pending.abortController.abort();
    pending.cleanup();
    return true;
  }
  return false;
}

function abortAllCodexPendingServerRequests(pendingServerRequests: CodexPendingServerRequests): void {
  const pending = new Set(pendingServerRequests.values());
  pendingServerRequests.clear();
  for (const request of pending) {
    request.abortController.abort();
    request.cleanup();
  }
}

function codexServerRequestKeys(request: CodexAppServerServerRequest): string[] {
  const params = request.params ?? {};
  return uniqueStrings([
    String(request.id),
    getIdLike(params, 'requestId'),
    getIdLike(params, 'serverRequestId'),
    getIdLike(params, 'jsonrpcId'),
    getIdLike(params, 'itemId'),
    getIdLike(params, 'callId'),
    getIdLike(params, 'id'),
  ]);
}

function codexServerRequestResolvedKeys(params: Record<string, unknown> | undefined): string[] {
  return uniqueStrings([
    getIdLike(params, 'requestId'),
    getIdLike(params, 'serverRequestId'),
    getIdLike(params, 'jsonrpcId'),
    getIdLike(params, 'itemId'),
    getIdLike(params, 'callId'),
    getIdLike(params, 'id'),
  ]);
}

function buildCodexPermissionRequest(request: CodexAppServerServerRequest): MindosRuntimePermissionRequest {
  const params = request.params ?? {};
  const toolCallId = getString(params, 'itemId')
    ?? getString(params, 'requestId')
    ?? getString(params, 'callId')
    ?? getString(params, 'id')
    ?? `codex-approval-${request.id}`;
  const command = getString(params, 'command')
    ?? getString(params, 'cmd')
    ?? getString(params, 'shellCommand');
  const filePath = getString(params, 'path')
    ?? getString(params, 'filePath')
    ?? getString(params, 'targetPath');
  const toolName = request.method === 'item/fileChange/requestApproval'
    ? 'file_change_approval'
    : command
      ? 'Bash'
      : 'approval_request';
  const action = request.method === 'item/fileChange/requestApproval'
    ? 'file-change'
    : command
      ? 'command'
      : 'tool-call';

  return {
    runtime: 'codex',
    toolCallId,
    toolName,
    input: {
      method: request.method,
      ...params,
    },
    options: getCodexPermissionOptions(params, request.method),
    action,
    ...(command || filePath ? { resource: command ?? filePath } : {}),
    ...(getString(params, 'reason') ?? getString(params, 'message') ? {
      reason: getString(params, 'reason') ?? getString(params, 'message'),
    } : {}),
  };
}

function buildCodexUserQuestionRequest(request: CodexAppServerServerRequest): MindosRuntimeUserQuestionRequest {
  const params = request.params ?? {};
  const toolCallId = getString(params, 'itemId')
    ?? getString(params, 'requestId')
    ?? getString(params, 'callId')
    ?? getString(params, 'id')
    ?? `codex-question-${request.id}`;
  const questions = normalizeCodexUserQuestions(params);

  return {
    runtime: 'codex',
    toolCallId,
    questions: questions.length > 0 ? questions : [{
      question: getString(params, 'message') ?? getString(params, 'reason') ?? 'Codex needs your input to continue.',
      header: getString(params, 'title') ?? 'Codex input',
      options: [
        { label: 'Continue', description: 'Allow Codex to continue with this request.' },
        { label: 'Cancel', description: 'Cancel this request.' },
      ],
    }],
  };
}

function normalizeCodexUserQuestions(params: Record<string, unknown>): MindosRuntimeUserQuestion[] {
  const rawQuestions = Array.isArray(params.questions)
    ? params.questions
    : isRecord(params.input) && Array.isArray(params.input.questions)
      ? params.input.questions
      : [];
  return rawQuestions
    .filter(isRecord)
    .map((question, index) => ({
      question: getString(question, 'question') ?? getString(question, 'text') ?? getString(question, 'message') ?? `Question ${index + 1}`,
      header: getString(question, 'header') ?? getString(question, 'title') ?? `Question ${index + 1}`,
      multiSelect: question.multiSelect === true || question.multiselect === true,
      options: normalizeCodexUserQuestionOptions(question.options),
    }));
}

function normalizeCodexUserQuestionOptions(value: unknown): MindosRuntimeUserQuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option): MindosRuntimeUserQuestionOption[] => {
    if (typeof option === 'string' && option.trim()) {
      return [{ label: option, description: option }];
    }
    if (!isRecord(option)) return [];
    const label = getString(option, 'label')
      ?? getString(option, 'value')
      ?? getString(option, 'title')
      ?? (option.isOther === true ? 'Other' : undefined);
    if (!label) return [];
    return [{
      label,
      description: getString(option, 'description') ?? getString(option, 'hint') ?? label,
      ...(getString(option, 'preview') ? { preview: getString(option, 'preview') } : {}),
    }];
  });
}

function getCodexPermissionOptions(params: Record<string, unknown>, method: string): MindosRuntimePermissionOption[] {
  const fromParams = [
    ...stringArray(params.availableDecisions),
    ...stringArray(params.decisions),
    ...stringArray(params.options),
  ].map(decisionOption);
  if (fromParams.length > 0) return dedupeOptions(fromParams);

  const defaults = method === 'item/permissions/requestApproval'
    ? ['accept', 'acceptForSession', 'decline']
    : ['accept', 'acceptForSession', 'decline'];
  return defaults.map(decisionOption);
}

function decisionOption(id: string): MindosRuntimePermissionOption {
  const labels: Record<string, string> = {
    accept: 'Allow once',
    acceptForSession: 'Allow session',
    decline: 'Deny',
    cancel: 'Cancel',
    deny: 'Deny',
  };
  const descriptions: Record<string, string> = {
    accept: 'Run this action one time.',
    acceptForSession: 'Run this action and remember the same rule for this Codex session.',
    decline: 'Reject this action.',
    cancel: 'Cancel the pending action.',
  };
  return {
    id,
    label: labels[id] ?? id,
    ...(descriptions[id] ? { description: descriptions[id] } : {}),
    intent: id === 'accept' || id === 'acceptForSession' ? 'allow' : id === 'decline' || id === 'deny' ? 'deny' : 'cancel',
    ...(id === 'accept' ? { scope: 'once' as const } : {}),
    ...(id === 'acceptForSession' ? { scope: 'session' as const } : {}),
  };
}

function dedupeOptions(options: MindosRuntimePermissionOption[]): MindosRuntimePermissionOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (!option.id || seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

function normalizeCodexApprovalDecision(decision: string): string {
  if (decision === 'accept' || decision === 'acceptForSession' || decision === 'decline' || decision === 'cancel') {
    return decision;
  }
  if (decision === 'deny' || decision === 'denied') return 'decline';
  return 'cancel';
}

function codexPermissionsApprovalResult(
  request: CodexAppServerServerRequest,
  result: MindosRuntimePermissionResult,
): Record<string, unknown> {
  const decision = result.cancelled ? 'cancel' : normalizeCodexApprovalDecision(result.decision);
  if (decision === 'decline' || decision === 'cancel') return { permissions: {} };
  const requestedPermissions = request.params?.permissions && typeof request.params.permissions === 'object'
    ? request.params.permissions
    : {};
  return {
    permissions: requestedPermissions,
    ...(decision === 'acceptForSession' ? { scope: 'session' } : {}),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getIdLike(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
