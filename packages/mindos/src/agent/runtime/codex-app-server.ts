import { createInterface } from 'node:readline';
import { appendBoundedLog } from './child-process.js';
import { buildCodexAppServerEnv } from './codex-env.js';
import { spawnSupervisedProcess } from './process-supervisor.js';
import {
  mindosSelectedSkillNames,
  type MindosSelectedSkill,
} from '../selected-skills.js';
import {
  getMindosRuntimeAttachmentImages,
  type MindosRuntimeAttachment,
} from './attachments.js';
import {
  asRecord,
  getCodexNotificationThreadId,
  getCodexNotificationTurnId,
  getStringParam,
  isCodexTerminalTurnNotification,
  safeJson,
} from './codex-app-server-events.js';

export {
  isCodexRetryingErrorNotification,
  isCodexTerminalTurnNotification,
  mapCodexAppServerNotificationToSseEvents,
} from './codex-app-server-events.js';


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
  /** Liveness probe used by the pool to drop transports whose process died while idle. */
  isAlive?(): boolean;
};

export type CodexAppServerClientOptions = {
  clientInfo?: CodexAppServerClientInfo;
  capabilities?: CodexAppServerClientCapabilities;
  handleServerRequest?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown;
};

export type CodexTurnInput = Array<
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }
>;

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

export type CodexReasoningEffortOption = {
  reasoningEffort: string;
  description: string;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  defaultReasoningEffort: string;
};

export type CodexModelListInput = {
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
};

export type CodexModelListResult = {
  data: CodexModel[];
  nextCursor: string | null;
};

export type CodexAppServerRequestOptions = {
  signal?: AbortSignal;
};

export type CodexAppServerClient = {
  initialize(options?: CodexAppServerRequestOptions): Promise<void>;
  startThread(input?: { model?: string; cwd?: string }, options?: CodexAppServerRequestOptions): Promise<{ threadId: string }>;
  resumeThread(input: { threadId: string }, options?: CodexAppServerRequestOptions): Promise<{ threadId: string }>;
  listModels(input?: CodexModelListInput): Promise<CodexModelListResult>;
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
  /**
   * Swap the server-request handler between turns. A pooled client serves one
   * turn after another, each with its own approval / question bridge; `undefined`
   * restores the default (cancel approvals, reject everything else).
   */
  setServerRequestHandler?(
    handler: ((request: CodexAppServerServerRequest) => Promise<unknown> | unknown) | undefined,
  ): void;
  /** False once the transport read loop ended (crash, kill) or the transport reports dead. */
  isAlive?(): boolean;
  close?(): void | Promise<void>;
};

export function buildCodexTurnInput(input: {
  prompt: string;
  selectedSkills?: MindosSelectedSkill[];
  attachments?: MindosRuntimeAttachment[];
}): CodexTurnInput {
  const textInput: CodexTurnInput[number] = {
    type: 'text',
    text: renderCodexTextWithSkillMarkers(input.prompt, input.selectedSkills),
  };
  const imageInputs = getMindosRuntimeAttachmentImages(input.attachments)
    .flatMap((attachment): CodexTurnInput => {
      if (attachment.path) return [{ type: 'localImage', path: attachment.path }];
      return [];
    });

  return [textInput, ...imageInputs];
}

export function renderCodexTextWithSkillMarkers(
  prompt: string,
  selectedSkills: MindosSelectedSkill[] | undefined,
): string {
  const skillNames = mindosSelectedSkillNames(selectedSkills);
  if (skillNames.length === 0) return prompt;

  let text = prompt;
  for (const skillName of skillNames) {
    text = text.replace(
      new RegExp(`(^|\\s)/${escapeRegExp(skillName)}(?=\\s|$)`, 'g'),
      (_match, prefix: string) => `${prefix}$${skillName}`,
    );
  }

  const missingMarkers = skillNames.filter((skillName) => (
    !new RegExp(`(^|\\s)\\$${escapeRegExp(skillName)}(?=\\s|$)`).test(text)
  ));
  if (missingMarkers.length === 0) return text;

  return [
    missingMarkers.map((skillName) => `$${skillName}`).join(' '),
    text.trim(),
  ].filter(Boolean).join('\n\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
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

  /**
   * Drop every buffered value no reader has consumed yet. A pooled client
   * calls this before `turn/start` so late notifications of an interrupted
   * earlier turn cannot leak into the next one. Waiting readers are untouched.
   */
  drain(): void {
    this.values.length = 0;
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
  let readEnded = false;
  // Set when the transport read loop dies (app-server crash, killed process).
  // Requests still pending at that moment are rejected directly, but an
  // in-flight turn whose turn/start already resolved would otherwise just see
  // the notification queue close and end silently without done/error.
  let readError: Error | undefined;
  // A pooled client serves one turn after another, each with its own approval
  // / question bridge, so the handler is swappable between turns.
  let serverRequestHandler = options.handleServerRequest;

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
        readError = err;
        for (const request of pending.values()) {
          request.cleanup();
          request.reject(err);
        }
        pending.clear();
      } finally {
        readEnded = true;
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
      const handler = serverRequestHandler;
      const result = handler
        ? await handler(message)
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
    async listModels(input = {}) {
      const result = await request('model/list', pruneUndefined(input as Record<string, unknown>));
      return getModelListResult(result, 'model/list');
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
      // Anything already queued belongs to an earlier turn on this app-server
      // (an interrupted turn's late notifications); it cannot be ours.
      notifications.drain();
      const started = await request('turn/start', params, input.signal);
      const turnId = getStringParam(asRecord(asRecord(started)?.turn) ?? undefined, 'id');
      let sawTerminal = false;
      for await (const notification of notifications) {
        if (!belongsToTurn(notification, input.threadId, turnId)) continue;
        yield notification;
        if (isCodexTerminalTurnNotification(notification)) {
          sawTerminal = true;
          break;
        }
      }
      if (sawTerminal) return;
      // The queue only closes when the read loop ends. Reaching this point
      // means the app-server went away mid-turn; surface that as a failure
      // instead of letting the caller record a silently truncated turn.
      if (readError) throw readError;
      throw new Error('Codex app-server stream ended before turn/completed.');
    },
    async interruptTurn(input) {
      await request('turn/interrupt', {
        threadId: input.threadId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
      });
    },
    setServerRequestHandler(handler) {
      serverRequestHandler = handler;
    },
    isAlive() {
      if (readEnded) return false;
      return transport.isAlive?.() ?? true;
    },
    close: () => transport.close?.(),
  };
}

/**
 * Notifications carrying a thread or turn identity that differs from the
 * running turn are leftovers of an earlier turn on the same pooled
 * app-server (typically the `turn/completed` of an interrupted one).
 * Notifications without identity are delivered unchanged.
 */
function belongsToTurn(notification: CodexAppServerNotification, threadId: string, turnId: string | undefined): boolean {
  const notificationThreadId = getCodexNotificationThreadId(notification);
  if (notificationThreadId && notificationThreadId !== threadId) return false;
  const notificationTurnId = getCodexNotificationTurnId(notification);
  if (turnId && notificationTurnId && notificationTurnId !== turnId) return false;
  return true;
}

export function createCodexAppServerStdioTransport(options: {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): CodexAppServerTransport {
  const command = options.command ?? 'codex';
  const args = options.args ?? ['app-server'];
  const supervised = spawnSupervisedProcess({
    label: 'codex-app-server',
    command,
    args,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: buildCodexAppServerEnv({ overrideEnv: options.env }),
  });
  const child = supervised.child;
  const lines = createInterface({ input: child.stdout! });
  let stderr = '';
  let spawnError: Error | null = null;
  let closedByUs = false;
  // Without an error listener, a write racing the child's exit raises an
  // unhandled 'error' event (EPIPE) and crashes the whole process.
  child.stdin?.on('error', () => {});
  child.stderr?.on('data', (chunk) => {
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
      if (closedByUs || child.exitCode !== null || child.signalCode !== null || !child.stdin?.writable) {
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
      supervised.kill();
    },
    isAlive() {
      return !closedByUs && supervised.alive;
    },
  };
}

function formatCodexJsonRpcError(method: string, error: { code?: number; message?: string; data?: unknown }): string {
  const parts = [
    error.message?.trim() || `Codex app-server ${method} failed`,
    typeof error.code === 'number' ? `method=${method} code=${error.code}` : `method=${method}`,
    error.data !== undefined ? `data=${safeJson(error.data)}` : '',
  ].filter(Boolean);
  return parts.join(' ');
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

function getModelListResult(result: unknown, method: string): CodexModelListResult {
  const record = asRecord(result);
  if (!record || !Array.isArray(record.data)) {
    throw new Error(`Codex app-server ${method} did not return a model list`);
  }
  return {
    data: record.data.map((item, index) => getModel(item, method, index)),
    nextCursor: typeof record.nextCursor === 'string' ? record.nextCursor : null,
  };
}

function getModel(value: unknown, method: string, index: number): CodexModel {
  const model = asRecord(value);
  if (!model || Array.isArray(value)) {
    throw new Error(`Codex app-server ${method} returned an invalid model at index ${index}`);
  }
  const supportedReasoningEfforts = model.supportedReasoningEfforts;
  if (!Array.isArray(supportedReasoningEfforts)) {
    throw new Error(`Codex app-server ${method} returned a model without supported reasoning efforts`);
  }
  return {
    id: requiredModelString(model, 'id', method),
    model: requiredModelString(model, 'model', method),
    displayName: requiredModelString(model, 'displayName', method),
    description: requiredModelString(model, 'description', method, true),
    hidden: requiredModelBoolean(model, 'hidden', method),
    isDefault: requiredModelBoolean(model, 'isDefault', method),
    supportedReasoningEfforts: supportedReasoningEfforts.map((option) => {
      const effort = asRecord(option);
      if (!effort || Array.isArray(option)) {
        throw new Error(`Codex app-server ${method} returned an invalid reasoning effort option`);
      }
      return {
        reasoningEffort: requiredModelString(effort, 'reasoningEffort', method),
        description: requiredModelString(effort, 'description', method, true),
      };
    }),
    defaultReasoningEffort: requiredModelString(model, 'defaultReasoningEffort', method),
  };
}

function requiredModelString(
  record: Record<string, unknown>,
  key: string,
  method: string,
  allowEmpty = false,
): string {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`Codex app-server ${method} returned a model with an invalid ${key}`);
  }
  return value;
}

function requiredModelBoolean(record: Record<string, unknown>, key: string, method: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Codex app-server ${method} returned a model with an invalid ${key}`);
  }
  return value;
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

function defaultCodexServerRequestResult(request: CodexAppServerServerRequest): unknown {
  if (/requestApproval|approval|permission/i.test(request.method)) {
    return { decision: 'cancel' };
  }
  throw new Error(`Unhandled Codex app-server request: ${request.method}`);
}
