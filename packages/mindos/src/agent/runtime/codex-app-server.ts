import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendBoundedLog, killChildWithEscalation } from './child-process.js';
import {
  redactSensitiveText,
  sanitizeToolArgs,
  sanitizeToolOutput,
  type MindOSSSEvent,
} from '../session/index.js';
import { buildCodexAppServerEnv } from './codex-env.js';
import { compactRuntimeFailureMessage } from './runtime-errors.js';

export type CodexAppServerClientInfo = {
  name: string;
  title: string;
  version: string;
};

export type CodexAppServerClientCapabilities = {
  experimentalApi?: boolean;
};

export type CodexAppServerRequest = {
  method: string;
  id: number;
  params?: Record<string, unknown>;
};

export type CodexAppServerServerRequest = {
  method: string;
  id: number;
  params?: Record<string, unknown>;
};

export type CodexAppServerNotification = {
  method: string;
  params?: Record<string, unknown>;
};

export type CodexAppServerResponse = {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type CodexAppServerClientResponse = {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type CodexAppServerMessage =
  | CodexAppServerResponse
  | CodexAppServerNotification
  | CodexAppServerServerRequest;

export type CodexAppServerTransport = {
  send(message: CodexAppServerRequest | CodexAppServerNotification | CodexAppServerClientResponse): void | Promise<void>;
  read(signal?: AbortSignal): AsyncIterable<CodexAppServerMessage>;
  close?(): void | Promise<void>;
};

export type CodexAppServerClientOptions = {
  clientInfo?: CodexAppServerClientInfo;
  capabilities?: CodexAppServerClientCapabilities;
  handleServerRequest?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown;
};

export type CodexTurnInput = Array<{ type: 'text'; text: string }>;

export type CodexThread = Record<string, unknown> & {
  id: string;
  sessionId?: string;
  preview?: string;
  name?: string | null;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: unknown;
  turns?: unknown[];
};

export type CodexThreadListInput = {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: string | null;
  sortDirection?: string | null;
  modelProviders?: string[] | null;
  sourceKinds?: string[] | null;
  archived?: boolean | null;
  cwd?: string | string[] | null;
  useStateDbOnly?: boolean;
  searchTerm?: string | null;
};

export type CodexThreadListResult = {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export type CodexThreadReadResult = {
  thread: CodexThread;
};

export type CodexThreadForkInput = {
  threadId: string;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: string | null;
  approvalsReviewer?: unknown;
  sandbox?: unknown;
  config?: Record<string, unknown> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
  threadSource?: unknown;
};

export type CodexThreadForkResult = Record<string, unknown> & {
  thread: CodexThread;
};

export type CodexAppServerRequestOptions = {
  signal?: AbortSignal;
};

export type CodexAppServerClient = {
  initialize(options?: CodexAppServerRequestOptions): Promise<void>;
  startThread(input?: { model?: string; cwd?: string }, options?: CodexAppServerRequestOptions): Promise<{ threadId: string }>;
  resumeThread(input: { threadId: string }, options?: CodexAppServerRequestOptions): Promise<{ threadId: string }>;
  listThreads(input?: CodexThreadListInput): Promise<CodexThreadListResult>;
  readThread(input: { threadId: string; includeTurns?: boolean }): Promise<CodexThreadReadResult>;
  forkThread(input: CodexThreadForkInput): Promise<CodexThreadForkResult>;
  archiveThread(input: { threadId: string }): Promise<void>;
  unarchiveThread(input: { threadId: string }): Promise<CodexThreadReadResult>;
  startTurn(input: {
    threadId: string;
    input: CodexTurnInput;
    cwd?: string;
    model?: string;
    effort?: string;
    approvalPolicy?: string;
    sandbox?: unknown;
    signal?: AbortSignal;
  }): AsyncIterable<CodexAppServerNotification>;
  interruptTurn?(input: { threadId: string; turnId?: string }): Promise<void>;
  close?(): void | Promise<void>;
};

type PendingRequest = {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private readers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const reader = this.readers.shift();
    if (reader) {
      reader({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
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

export function createCodexAppServerClient(
  transport: CodexAppServerTransport,
  options: CodexAppServerClientOptions = {},
): CodexAppServerClient {
  const clientInfo = options.clientInfo ?? {
    name: 'codex-mindos',
    title: 'Codex MindOS',
    version: '0.1.0',
  };
  const capabilities = options.capabilities ?? {
    experimentalApi: true,
  };
  const pending = new Map<number, PendingRequest>();
  const notifications = new AsyncQueue<CodexAppServerNotification>();
  let nextId = 1;
  let readStarted = false;

  const startReadLoop = (signal?: AbortSignal) => {
    if (readStarted) return;
    readStarted = true;
    void (async () => {
      try {
        for await (const message of transport.read(signal)) {
          if (isCodexResponse(message)) {
            const request = pending.get(message.id);
            if (!request) continue;
            pending.delete(message.id);
            request.cleanup();
            if (message.error) {
              request.reject(new Error(formatCodexJsonRpcError(request.method, message.error)));
            } else {
              request.resolve(message.result);
            }
            continue;
          }
          if (isCodexServerRequest(message)) {
            void respondToServerRequest(message).catch((error) => {
              const err = error instanceof Error ? error : new Error(String(error));
              notifications.push({
                method: 'error',
                params: { message: `Codex app-server request ${message.method} failed: ${err.message}` },
              });
            });
            continue;
          }
          if (isCodexNotification(message)) notifications.push(message);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        for (const request of pending.values()) {
          request.cleanup();
          request.reject(err);
        }
        pending.clear();
      } finally {
        notifications.close();
      }
    })();
  };

  const request = async (method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> => {
    startReadLoop(signal);
    if (signal?.aborted) throw new Error(`Codex app-server ${method} aborted.`);
    const id = nextId++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const response = new Promise<unknown>((resolve, reject) => {
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
      };
      const rejectPending = (error: Error) => {
        const pendingRequest = pending.get(id);
        if (!pendingRequest) return;
        pending.delete(id);
        pendingRequest.cleanup();
        pendingRequest.reject(error);
      };
      abortListener = () => rejectPending(new Error(`Codex app-server ${method} aborted.`));
      timer = setTimeout(() => {
        rejectPending(new Error(`Codex app-server ${method} timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms.`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      signal?.addEventListener('abort', abortListener, { once: true });
      pending.set(id, { method, resolve, reject, cleanup });
    });
    try {
      await transport.send({ method, id, params });
    } catch (error) {
      const pendingRequest = pending.get(id);
      if (pendingRequest) {
        pending.delete(id);
        pendingRequest.cleanup();
        pendingRequest.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return response;
  };

  const notify = async (method: string, params: Record<string, unknown> = {}): Promise<void> => {
    await transport.send({ method, params });
  };

  const respondToServerRequest = async (message: CodexAppServerServerRequest): Promise<void> => {
    try {
      const result = options.handleServerRequest
        ? await options.handleServerRequest(message)
        : defaultCodexServerRequestResult(message);
      await transport.send({ id: message.id, result });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await transport.send({
        id: message.id,
        error: {
          code: -32000,
          message: err.message || `Codex app-server request ${message.method} failed`,
        },
      });
    }
  };

  return {
    async initialize(options = {}) {
      await request('initialize', { clientInfo, capabilities }, options.signal);
      await notify('initialized');
    },
    async startThread(input = {}, options = {}) {
      const params = pruneUndefined({
        model: input.model,
        cwd: input.cwd,
      });
      const result = await request('thread/start', params, options.signal);
      return { threadId: getThreadId(result, 'thread/start') };
    },
    async resumeThread(input, options = {}) {
      const result = await request('thread/resume', { threadId: input.threadId }, options.signal);
      return { threadId: getThreadId(result, 'thread/resume') ?? input.threadId };
    },
    async listThreads(input = {}) {
      const result = await request('thread/list', pruneUndefined(input as Record<string, unknown>));
      return getThreadListResult(result, 'thread/list');
    },
    async readThread(input) {
      const result = await request('thread/read', {
        threadId: input.threadId,
        ...(typeof input.includeTurns === 'boolean' ? { includeTurns: input.includeTurns } : {}),
      });
      return { thread: getThread(result, 'thread/read') };
    },
    async forkThread(input) {
      const result = await request('thread/fork', pruneUndefined(input as Record<string, unknown>));
      const record = asRecord(result);
      return {
        ...(record ?? {}),
        thread: getThread(result, 'thread/fork'),
      };
    },
    async archiveThread(input) {
      await request('thread/archive', { threadId: input.threadId });
    },
    async unarchiveThread(input) {
      const result = await request('thread/unarchive', { threadId: input.threadId });
      return { thread: getThread(result, 'thread/unarchive') };
    },
    async *startTurn(input) {
      const params: Record<string, unknown> = {
        threadId: input.threadId,
        input: input.input,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
        ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      };
      await request('turn/start', params, input.signal);
      for await (const notification of notifications) {
        yield notification;
        if (isCodexTerminalTurnNotification(notification)) break;
      }
    },
    async interruptTurn(input) {
      await request('turn/interrupt', {
        threadId: input.threadId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
      });
    },
    close: () => transport.close?.(),
  };
}

export function createCodexAppServerStdioTransport(options: {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): CodexAppServerTransport {
  const command = options.command ?? 'codex';
  const args = options.args ?? ['app-server'];
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: buildCodexAppServerEnv({ overrideEnv: options.env }),
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  let spawnError: Error | null = null;
  let closedByUs = false;
  // Without an error listener, a write racing the child's exit raises an
  // unhandled 'error' event (EPIPE) and crashes the whole process.
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => {
    stderr = appendBoundedLog(stderr, chunk);
  });
  child.once('error', (error) => {
    spawnError = error;
  });
  const childClose = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  return {
    send(message) {
      if (closedByUs || child.exitCode !== null || child.signalCode !== null || !child.stdin.writable) {
        throw new Error(stderr.trim() || 'Codex app-server is not running (stdin is closed).');
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    async *read() {
      try {
        for await (const line of lines) {
          if (typeof line !== 'string' || !line.trim()) continue;
          // Startup noise or partial writes on stdout must not kill the session.
          let message: CodexAppServerMessage | null = null;
          try {
            const parsed = JSON.parse(line) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              message = parsed as CodexAppServerMessage;
            }
          } catch {
            continue;
          }
          if (message) yield message;
        }
        const result = await childClose;
        if (spawnError) throw spawnError;
        if (result.code && result.code !== 0) {
          throw new Error(stderr.trim() || `Codex app-server exited with code ${result.code}`);
        }
        if (result.signal && !closedByUs) {
          throw new Error(stderr.trim() || `Codex app-server was killed by signal ${result.signal}`);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err.message) throw err;
        throw new Error(stderr.trim() || 'Codex app-server stopped unexpectedly');
      }
    },
    close() {
      closedByUs = true;
      lines.close();
      killChildWithEscalation(child);
    },
  };
}

export function mapCodexAppServerNotificationToSseEvents(notification: CodexAppServerNotification): MindOSSSEvent[] {
  const toolEvents = mapCodexRuntimeToolNotification(notification);
  if (toolEvents.length > 0) return toolEvents;

  if (notification.method === 'error') {
    return [{
      type: 'error',
      message: compactRuntimeFailureMessage(
        redactSensitiveText(getCodexErrorMessage(notification.params, 'Codex app-server error')),
        { runtime: 'codex', fallback: 'Codex app-server error' },
      ),
    }];
  }

  if (notification.method === 'item/agentMessage/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'text_delta', delta }] : [];
  }

  if (notification.method === 'item/thinking/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'thinking_delta', delta }] : [];
  }

  if (
    notification.method === 'item/reasoning/textDelta'
    || notification.method === 'item/reasoning/summaryTextDelta'
    || notification.method === 'item/reasoning/summaryPartAdded'
  ) {
    const delta = getStringParam(notification.params, 'delta')
      ?? getStringParam(notification.params, 'text')
      ?? getStringParam(notification.params, 'summary');
    return delta ? [{ type: 'thinking_delta', delta }] : [];
  }

  if (notification.method === 'turn/completed') {
    const status = getCodexTurnStatus(notification.params);
    if (status && status !== 'completed' && status !== 'success') {
      return [{
        type: 'error',
        message: compactRuntimeFailureMessage(
          redactSensitiveText(getCodexErrorMessage(notification.params, `Codex turn ${status}`)),
          { runtime: 'codex', fallback: `Codex turn ${status}` },
        ),
      }];
    }
    return [{ type: 'done' }];
  }

  if (notification.method === 'turn/failed') {
    return [{
      type: 'error',
      message: compactRuntimeFailureMessage(
        redactSensitiveText(getCodexErrorMessage(notification.params, 'Codex turn failed')),
        { runtime: 'codex', fallback: 'Codex turn failed' },
      ),
    }];
  }

  return [];
}

function mapCodexRuntimeToolNotification(notification: CodexAppServerNotification): MindOSSSEvent[] {
  const method = notification.method;
  const lower = method.toLowerCase();
  const params = notification.params ?? {};

  const officialItemEvents = mapCodexOfficialItemNotification(method, params);
  if (officialItemEvents.length > 0) return officialItemEvents;

  if (!/(tool|command|exec|approval|permission|patch)/.test(lower)) return [];

  const toolCallId = getCodexToolCallId(method, params);
  const toolName = getCodexToolName(method, params);
  if (!toolCallId || !toolName) return [];

  if (/outputdelta|output_delta/.test(lower)) {
    const delta = getStringParam(params, 'delta')
      ?? getStringParam(params, 'output')
      ?? getStringParam(params, 'text');
    return delta ? [{
      type: 'tool_delta',
      toolCallId,
      toolName,
      delta: redactSensitiveText(delta),
      runtime: 'codex',
    }] : [];
  }

  if (/(end|ended|complete|completed|result|output|failed|error|rejected|denied|approved|allowed)/.test(lower)) {
    return [{
      type: 'tool_end',
      toolCallId,
      toolName,
      output: sanitizeToolOutput(getCodexToolOutput(params)),
      isError: /(failed|error|rejected|denied)/.test(lower) || params.isError === true || params.error !== undefined,
      runtime: 'codex',
    }];
  }

  if (/(start|started|begin|began|added|call|request|requested|created)/.test(lower)) {
    return [{
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, getCodexToolInput(params)),
      runtime: 'codex',
    }];
  }

  return [];
}

function mapCodexOfficialItemNotification(
  method: string,
  params: Record<string, unknown>,
): MindOSSSEvent[] {
  if (method === 'item/commandExecution/outputDelta') {
    const toolCallId = getCodexToolCallId(method, params);
    const delta = getStringParam(params, 'delta')
      ?? getStringParam(params, 'output')
      ?? getStringParam(params, 'text');
    if (!toolCallId || !delta) return [];
    return [{
      type: 'tool_delta',
      toolCallId,
      toolName: getCodexToolName(method, params),
      delta: redactSensitiveText(delta),
      runtime: 'codex',
    }];
  }

  if (method !== 'item/started' && method !== 'item/completed') return [];

  const item = getCodexItem(params);
  if (!item || !isCodexRuntimeToolItem(item)) return [];
  const toolCallId = getCodexToolCallId(method, params);
  const toolName = getCodexToolName(method, params);
  if (!toolCallId || !toolName) return [];

  if (method === 'item/started') {
    return [{
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, getCodexToolInput(params)),
      runtime: 'codex',
    }];
  }

  const status = getStringField(item, 'status') ?? getStringParam(params, 'status');
  return [{
    type: 'tool_end',
    toolCallId,
    toolName,
    output: sanitizeToolOutput(getCodexToolOutput(params)),
    isError: status === 'failed'
      || status === 'error'
      || status === 'declined'
      || params.isError === true
      || params.error !== undefined
      || item.error !== undefined,
    runtime: 'codex',
  }];
}

function formatCodexJsonRpcError(method: string, error: { code?: number; message?: string; data?: unknown }): string {
  const parts = [
    error.message?.trim() || `Codex app-server ${method} failed`,
    typeof error.code === 'number' ? `method=${method} code=${error.code}` : `method=${method}`,
    error.data !== undefined ? `data=${safeJson(error.data)}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isCodexResponse(message: CodexAppServerMessage): message is CodexAppServerResponse {
  return typeof (message as CodexAppServerResponse).id === 'number'
    && typeof (message as CodexAppServerServerRequest).method !== 'string';
}

function isCodexNotification(message: CodexAppServerMessage): message is CodexAppServerNotification {
  return typeof (message as CodexAppServerNotification).method === 'string'
    && typeof (message as CodexAppServerServerRequest).id !== 'number';
}

function isCodexServerRequest(message: CodexAppServerMessage): message is CodexAppServerServerRequest {
  return typeof (message as CodexAppServerServerRequest).id === 'number'
    && typeof (message as CodexAppServerServerRequest).method === 'string';
}

function isCodexTerminalTurnNotification(notification: CodexAppServerNotification): boolean {
  return (
    notification.method === 'error'
    || notification.method === 'turn/completed'
    || notification.method === 'turn/failed'
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getThreadId(result: unknown, method: string): string {
  return getThread(result, method).id;
}

function getThread(result: unknown, method: string): CodexThread {
  const record = asRecord(result);
  const thread = asRecord(record?.thread);
  const id = thread?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error(`Codex app-server ${method} did not return a thread id`);
  }
  return { ...thread, id } as CodexThread;
}

function getThreadListResult(result: unknown, method: string): CodexThreadListResult {
  const record = asRecord(result);
  if (!record || !Array.isArray(record.data)) {
    throw new Error(`Codex app-server ${method} did not return a thread list`);
  }
  return {
    data: record.data.map((item) => {
      const thread = asRecord(item);
      const id = thread?.id;
      if (typeof id !== 'string' || !id) {
        throw new Error(`Codex app-server ${method} returned a thread without an id`);
      }
      return { ...thread, id } as CodexThread;
    }),
    nextCursor: typeof record.nextCursor === 'string' ? record.nextCursor : null,
    backwardsCursor: typeof record.backwardsCursor === 'string' ? record.backwardsCursor : null,
  };
}

function pruneUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function getStringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getCodexItem(params: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(params.item) ?? params;
}

function getCodexItemType(item: Record<string, unknown> | null): string {
  return getStringField(item, 'type') ?? getStringField(item, 'kind') ?? '';
}

function isCodexRuntimeToolItem(item: Record<string, unknown>): boolean {
  const type = getCodexItemType(item).toLowerCase();
  return type.includes('command')
    || type.includes('filechange')
    || type.includes('file_change')
    || type.includes('tool')
    || type.includes('dynamic')
    || Boolean(getStringField(item, 'command'))
    || Boolean(getStringField(item, 'toolName'))
    || Boolean(getStringField(item, 'name'));
}

function getCodexToolCallId(method: string, params: Record<string, unknown>): string {
  const direct = getStringParam(params, 'toolCallId')
    ?? getStringParam(params, 'callId')
    ?? getStringParam(params, 'itemId')
    ?? getStringParam(params, 'requestId')
    ?? getStringParam(params, 'id');
  if (direct) return direct;

  const item = asRecord(params.item);
  const nested = getStringField(item, 'id') ?? getStringField(item, 'callId');
  return nested ?? `codex-${method}`;
}

function getCodexToolName(method: string, params: Record<string, unknown>): string {
  const direct = getStringParam(params, 'toolName')
    ?? getStringParam(params, 'name')
    ?? getStringParam(params, 'tool')
    ?? getStringParam(params, 'commandName');
  if (direct) return direct;
  if (getStringParam(params, 'command')) return 'Bash';
  if (method.toLowerCase().includes('commandexecution')) return 'Bash';
  if (method.toLowerCase().includes('approval') || method.toLowerCase().includes('permission')) return 'approval_request';

  const item = getCodexItem(params);
  const itemType = getCodexItemType(item).toLowerCase();
  const itemTool = asRecord(item?.tool) ?? asRecord(item?.mcpTool) ?? asRecord(item?.dynamicTool);
  const itemServer = asRecord(item?.server) ?? asRecord(item?.mcpServer);
  if (getStringField(item, 'command')) return 'Bash';
  if (itemType.includes('command')) return 'Bash';
  if (itemType.includes('filechange') || itemType.includes('file_change')) return 'file_change';
  const nestedToolName = getStringField(itemTool, 'name')
    ?? getStringField(itemTool, 'toolName')
    ?? getStringField(item, 'serverToolName');
  const serverName = getStringField(itemServer, 'name') ?? getStringField(itemServer, 'serverName');
  if (serverName && nestedToolName) return `${serverName}.${nestedToolName}`;
  return getStringField(item, 'name')
    ?? getStringField(item, 'toolName')
    ?? nestedToolName
    ?? method.split('/').at(-1)
    ?? method;
}

function getCodexToolInput(params: Record<string, unknown>): unknown {
  const item = getCodexItem(params);
  const itemTool = asRecord(item?.tool) ?? asRecord(item?.mcpTool) ?? asRecord(item?.dynamicTool);
  return params.input
    ?? params.arguments
    ?? params.args
    ?? params.command
    ?? item?.input
    ?? item?.arguments
    ?? item?.args
    ?? item?.command
    ?? itemTool?.input
    ?? itemTool?.arguments
    ?? itemTool?.args
    ?? params;
}

function getCodexToolOutput(params: Record<string, unknown>): string {
  const direct = getStringParam(params, 'output')
    ?? getStringParam(params, 'result')
    ?? getStringParam(params, 'message')
    ?? getStringParam(params, 'text');
  if (direct) return direct;

  const error = asRecord(params.error);
  const errorMessage = getStringField(error, 'message') ?? getStringField(error, 'detail');
  if (errorMessage) return errorMessage;

  const item = getCodexItem(params);
  const itemOutput = getStringField(item, 'output') ?? getStringField(item, 'result');
  if (itemOutput) return itemOutput;

  const itemTool = asRecord(item?.tool) ?? asRecord(item?.mcpTool) ?? asRecord(item?.dynamicTool);
  const toolOutput = getStringField(itemTool, 'output') ?? getStringField(itemTool, 'result');
  if (toolOutput) return toolOutput;

  const itemError = asRecord(item?.error);
  const itemErrorMessage = getStringField(itemError, 'message') ?? getStringField(itemError, 'detail');
  if (itemErrorMessage) return itemErrorMessage;

  const status = getStringField(item, 'status') ?? getStringParam(params, 'status');
  if (status) return `Codex item ${status}`;

  return safeJson(params);
}

function getCodexTurnStatus(params: Record<string, unknown> | undefined): string | undefined {
  const direct = getStringParam(params, 'status');
  if (direct) return direct;
  const turn = asRecord(params?.turn);
  const nested = turn?.status;
  return typeof nested === 'string' ? nested : undefined;
}

function getCodexErrorMessage(params: Record<string, unknown> | undefined, fallback: string): string {
  const direct = getStringParam(params, 'message') ?? getStringParam(params, 'errorMessage');
  if (direct) return direct;

  const error = asRecord(params?.error);
  const errorMessage = getStringField(error, 'message') ?? getStringField(error, 'detail');
  if (errorMessage) return errorMessage;

  const turn = asRecord(params?.turn);
  const turnError = asRecord(turn?.error);
  const turnMessage = getStringField(turnError, 'message')
    ?? getStringField(turnError, 'detail')
    ?? getStringField(turn, 'message');
  if (turnMessage) return turnMessage;

  const status = getCodexTurnStatus(params);
  return status ? `${fallback}: ${status}` : fallback;
}

function getStringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function defaultCodexServerRequestResult(request: CodexAppServerServerRequest): unknown {
  if (/requestApproval|approval|permission/i.test(request.method)) {
    return { decision: 'cancel' };
  }
  throw new Error(`Unhandled Codex app-server request: ${request.method}`);
}
