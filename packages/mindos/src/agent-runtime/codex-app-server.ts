import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { MindOSSSEvent } from '../session/index.js';

export type CodexAppServerClientInfo = {
  name: string;
  title: string;
  version: string;
};

export type CodexAppServerRequest = {
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

export type CodexAppServerMessage = CodexAppServerResponse | CodexAppServerNotification;

export type CodexAppServerTransport = {
  send(message: CodexAppServerRequest | CodexAppServerNotification): void | Promise<void>;
  read(signal?: AbortSignal): AsyncIterable<CodexAppServerMessage>;
  close?(): void | Promise<void>;
};

export type CodexAppServerClientOptions = {
  clientInfo?: CodexAppServerClientInfo;
};

export type CodexTurnInput = Array<{ type: 'text'; text: string }>;

export type CodexAppServerClient = {
  initialize(): Promise<void>;
  startThread(input?: { model?: string }): Promise<{ threadId: string }>;
  resumeThread(input: { threadId: string }): Promise<{ threadId: string }>;
  startTurn(input: {
    threadId: string;
    input: CodexTurnInput;
    cwd?: string;
    signal?: AbortSignal;
  }): AsyncIterable<CodexAppServerNotification>;
  interruptTurn?(input: { threadId: string; turnId?: string }): Promise<void>;
  close?(): void | Promise<void>;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

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
    name: 'mindos',
    title: 'MindOS',
    version: '0.1.0',
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
            if (message.error) {
              request.reject(new Error(message.error.message ?? `Codex app-server error ${message.error.code ?? ''}`.trim()));
            } else {
              request.resolve(message.result);
            }
            continue;
          }
          if (isCodexNotification(message)) notifications.push(message);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        for (const request of pending.values()) request.reject(err);
        pending.clear();
      } finally {
        notifications.close();
      }
    })();
  };

  const request = async (method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> => {
    startReadLoop(signal);
    const id = nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    await transport.send({ method, id, params });
    return response;
  };

  const notify = async (method: string, params: Record<string, unknown> = {}): Promise<void> => {
    await transport.send({ method, params });
  };

  return {
    async initialize() {
      await request('initialize', { clientInfo });
      await notify('initialized');
    },
    async startThread(input = {}) {
      const params = input.model ? { model: input.model } : {};
      const result = await request('thread/start', params);
      return { threadId: getThreadId(result, 'thread/start') };
    },
    async resumeThread(input) {
      const result = await request('thread/resume', { threadId: input.threadId });
      return { threadId: getThreadId(result, 'thread/resume') ?? input.threadId };
    },
    async *startTurn(input) {
      const params: Record<string, unknown> = {
        threadId: input.threadId,
        input: input.input,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      };
      await request('turn/start', params, input.signal);
      for await (const notification of notifications) {
        yield notification;
        if (notification.method === 'turn/completed' || notification.method === 'turn/failed') break;
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
    env: { ...process.env, ...(options.env ?? {}) },
  });
  const lines = createInterface({ input: child.stdout });

  return {
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    async *read() {
      for await (const line of lines) {
        if (typeof line !== 'string' || !line.trim()) continue;
        yield JSON.parse(line) as CodexAppServerMessage;
      }
    },
    close() {
      lines.close();
      child.kill();
    },
  };
}

export function mapCodexAppServerNotificationToSseEvents(notification: CodexAppServerNotification): MindOSSSEvent[] {
  if (notification.method === 'item/agentMessage/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'text_delta', delta }] : [];
  }

  if (notification.method === 'item/thinking/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'thinking_delta', delta }] : [];
  }

  if (notification.method === 'turn/completed') {
    return [{ type: 'done' }];
  }

  if (notification.method === 'turn/failed') {
    return [{ type: 'error', message: getStringParam(notification.params, 'message') ?? 'Codex turn failed' }];
  }

  return [];
}

function isCodexResponse(message: CodexAppServerMessage): message is CodexAppServerResponse {
  return typeof (message as CodexAppServerResponse).id === 'number';
}

function isCodexNotification(message: CodexAppServerMessage): message is CodexAppServerNotification {
  return typeof (message as CodexAppServerNotification).method === 'string';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getThreadId(result: unknown, method: string): string {
  const record = asRecord(result);
  const thread = asRecord(record?.thread);
  const id = thread?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error(`Codex app-server ${method} did not return a thread id`);
  }
  return id;
}

function getStringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' ? value : undefined;
}
