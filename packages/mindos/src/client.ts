import * as childProcess from 'node:child_process';
import { parseMindosSseLine, type MindOSSSEvent } from './agent/turn/index.js';

export type MindosClientConfig = {
  baseUrl?: string | URL;
  hostname?: string;
  port?: string | number;
  token?: string;
  headers?: HeadersInit;
  fetch?: typeof globalThis.fetch;
};

export type MindosRequestOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  signal?: AbortSignal;
};

export type MindosHealth = {
  ok: boolean;
  service: string;
  version: string;
  authRequired?: boolean;
  runtime?: {
    platform: string;
    arch: string;
    node: string;
    root?: string;
  };
};

export type MindosFilesPage = {
  files: string[];
  total: number;
  offset: number;
  limit: number;
};

export type MindosFilesOptions = {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export type MindosSearchOptions = {
  limit?: number;
  scope?: string;
  file_type?: 'md' | 'csv' | 'all';
  modified_after?: string;
  signal?: AbortSignal;
};

export type MindosSettings = Record<string, unknown>;

export type MindosAgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';

export type MindosSelectedRuntime = {
  id: string;
  name: string;
  kind: MindosAgentRuntimeKind;
  binaryPath?: string;
};

export type MindosRuntimeSessionBinding = {
  kind: 'codex-thread' | 'claude-session' | 'acp-session';
  runtime: Exclude<MindosAgentRuntimeKind, 'mindos'>;
  runtimeId: string;
  externalSessionId?: string;
  cwd?: string;
  status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
  updatedAt: number;
};

export type MindosUploadedFile = {
  name: string;
  content: string;
  mimeType?: string;
  size?: number;
  dataBase64?: string;
};

export type MindosAgentTurnRequest = {
  sessionId: string;
  messages: Array<Record<string, unknown>>;
  agentMode?: 'default' | 'plan' | 'goal';
  permissionMode?: 'read' | 'ask' | 'auto' | 'full';
  currentFile?: string;
  attachedFiles?: string[];
  uploadedFiles?: MindosUploadedFile[];
  maxSteps?: number;
  assistantId?: string;
  selectedRuntime?: MindosSelectedRuntime | null;
  runtimeBinding?: MindosRuntimeSessionBinding | null;
  selectedAcpAgent?: { id: string; name: string } | null;
  runtimeOptions?: {
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    modelOverride?: string;
  };
  providerOverride?: string;
  modelOverride?: string;
};

export type MindosMcpStatus = {
  running: boolean;
  transport: 'http';
  endpoint: string;
  port: number;
  toolCount: number;
  authConfigured: boolean;
  maskedToken?: string;
  localIP: string | null;
  connectionMode: {
    cli: boolean;
    mcp: boolean;
  };
};

export class MindosHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(message: string, details: { status: number; url: string; body: unknown }) {
    super(message);
    this.name = 'MindosHttpError';
    this.status = details.status;
    this.url = details.url;
    this.body = details.body;
  }
}

export type MindosClient = {
  readonly baseUrl: string;
  request<T = unknown>(path: string, options?: MindosRequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: Omit<MindosRequestOptions, 'method' | 'body'>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: Omit<MindosRequestOptions, 'method' | 'body'>): Promise<T>;
  health(options?: Omit<MindosRequestOptions, 'method' | 'body'>): Promise<MindosHealth>;
  files(options?: MindosFilesOptions): Promise<string[] | MindosFilesPage>;
  search<TSearchResult = unknown>(query: string, options?: MindosSearchOptions): Promise<TSearchResult[]>;
  settings(options?: Omit<MindosRequestOptions, 'method' | 'body'>): Promise<MindosSettings>;
  updateSettings(settings: MindosSettings, options?: Omit<MindosRequestOptions, 'method' | 'body'>): Promise<{ ok: true }>;
  mcpStatus(options?: Omit<MindosRequestOptions, 'method' | 'body'>): Promise<MindosMcpStatus>;
  agentTurnStream(input: MindosAgentTurnRequest, options?: Omit<MindosRequestOptions, 'method' | 'body'>): AsyncIterable<MindOSSSEvent>;
};

export type MindosServerOptions = {
  command?: string;
  hostname?: string;
  port?: string | number;
  token?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  verbose?: boolean;
};

export type MindosServer = {
  readonly url: string;
  readonly process: childProcess.ChildProcess;
  close(): Promise<void>;
};

export type MindosServerSpawnSpec = {
  command: string;
  shell: boolean;
};

const DEFAULT_HOSTNAME = '127.0.0.1';
const DEFAULT_PORT = 3456;

function createBaseUrl(config: MindosClientConfig = {}) {
  if (config.baseUrl) return new URL(config.baseUrl).toString().replace(/\/$/, '');
  const hostname = config.hostname ?? DEFAULT_HOSTNAME;
  const port = config.port ?? process.env.MINDOS_WEB_PORT ?? DEFAULT_PORT;
  return `http://${hostname}:${port}`;
}

function mergeHeaders(config: MindosClientConfig, options?: MindosRequestOptions) {
  const headers = new Headers(config.headers);
  for (const [key, value] of new Headers(options?.headers).entries()) {
    headers.set(key, value);
  }

  const token = config.token ?? process.env.MINDOS_AUTH_TOKEN;
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return headers;
}

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function isBodyInit(value: unknown): value is BodyInit {
  return typeof value === 'string'
    || value instanceof ArrayBuffer
    || value instanceof Blob
    || value instanceof FormData
    || value instanceof URLSearchParams
    || value instanceof ReadableStream;
}

function createRequestBody(body: unknown, headers: Headers) {
  if (body === undefined || body === null) return undefined;
  if (isBodyInit(body)) return body;
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return JSON.stringify(body);
}

async function readResponse(res: Response) {
  if (res.status === 204) return undefined;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<MindOSSSEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseMindosSseLine(line);
        if (event) yield event;
      }
    }

    if (buffer.trim()) {
      const event = parseMindosSseLine(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

export function createMindosClient(config: MindosClientConfig = {}): MindosClient {
  const baseUrl = createBaseUrl(config);
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('No fetch implementation available. Pass config.fetch.');
  }

  async function request<T = unknown>(path: string, options: MindosRequestOptions = {}): Promise<T> {
    const url = new URL(normalizePath(path), `${baseUrl}/`);
    const headers = mergeHeaders(config, options);
    const body = createRequestBody(options.body, headers);
    const res = await fetchImpl(url, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      signal: options.signal,
    });
    const parsed = await readResponse(res);
    if (!res.ok) {
      throw new MindosHttpError(`MindOS API request failed (${res.status})`, {
        status: res.status,
        url: url.toString(),
        body: parsed,
      });
    }
    return parsed as T;
  }

  function agentTurnStream(input: MindosAgentTurnRequest, options: Omit<MindosRequestOptions, 'method' | 'body'> = {}) {
    return (async function* streamEvents() {
      const url = new URL(`/api/agent/sessions/${encodeURIComponent(input.sessionId)}/turns`, `${baseUrl}/`);
      const headers = mergeHeaders(config, options);
      const turnInput: Omit<MindosAgentTurnRequest, 'sessionId'> = { ...input };
      delete (turnInput as Partial<MindosAgentTurnRequest>).sessionId;
      const body = createRequestBody(turnInput, headers);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: options.signal,
      });
      if (!res.ok) {
        const parsed = await readResponse(res);
        throw new MindosHttpError(`MindOS API request failed (${res.status})`, {
          status: res.status,
          url: url.toString(),
          body: parsed,
        });
      }
      if (!res.body) throw new Error('MindOS agent turn stream response did not include a body');
      yield* readSseEvents(res.body);
    })();
  }

  return {
    baseUrl,
    request,
    get(path, options) {
      return request(path, { ...options, method: 'GET' });
    },
    post(path, body, options) {
      return request(path, { ...options, method: 'POST', body });
    },
    health(options) {
      return request<MindosHealth>('/api/health', { ...options, method: 'GET' });
    },
    files(options = {}) {
      const params = new URLSearchParams();
      if (options.limit !== undefined) params.set('limit', String(options.limit));
      if (options.offset !== undefined) params.set('offset', String(options.offset));
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return request<string[] | MindosFilesPage>(`/api/files${suffix}`, {
        method: 'GET',
        signal: options.signal,
      });
    },
    search(query, options) {
      const params = new URLSearchParams({ q: query });
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.scope) params.set('scope', options.scope);
      if (options?.file_type) params.set('file_type', options.file_type);
      if (options?.modified_after) params.set('modified_after', options.modified_after);
      return request(`/api/search?${params.toString()}`, {
        method: 'GET',
        signal: options?.signal,
      });
    },
    settings(options) {
      return request<MindosSettings>('/api/settings', { ...options, method: 'GET' });
    },
    updateSettings(settings, options) {
      return request<{ ok: true }>('/api/settings', { ...options, method: 'POST', body: settings });
    },
    mcpStatus(options) {
      return request<MindosMcpStatus>('/api/mcp/status', { ...options, method: 'GET' });
    },
    agentTurnStream(input, options) {
      return agentTurnStream(input, options);
    },
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(client: MindosClient, timeoutMs: number, pollIntervalMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    if (signal?.aborted) throw signal.reason;
    try {
      const health = await client.health({ signal });
      if (health.ok) return health;
    } catch (error) {
      lastError = error;
    }
    await delay(pollIntervalMs);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for MindOS server after ${timeoutMs}ms.${suffix}`);
}

function terminateProcess(proc: childProcess.ChildProcess) {
  return new Promise<void>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      resolve();
    }, 3000);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    proc.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  });
}

function createProcessFailureWaiter(proc: childProcess.ChildProcess) {
  let cleanup = () => {};
  const promise = new Promise<never>((_, reject) => {
    cleanup = () => {
      proc.off('error', onError);
      proc.off('exit', onExit);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`MindOS server exited before becoming healthy (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
    };
    proc.once('error', onError);
    proc.once('exit', onExit);
  });
  return { promise, cleanup };
}

function resolveWindowsCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  try {
    const stdout = childProcess.execFileSync('where', [trimmed], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export function resolveMindosServerSpawn(command: string): MindosServerSpawnSpec {
  if (process.platform !== 'win32') {
    return { command, shell: false };
  }

  const resolvedCommand = resolveWindowsCommand(command) ?? command.trim();
  return {
    command: resolvedCommand,
    shell: /\.(?:cmd|bat)$/i.test(resolvedCommand),
  };
}

export async function createMindosServer(options: MindosServerOptions = {}): Promise<MindosServer> {
  const hostname = options.hostname ?? DEFAULT_HOSTNAME;
  const port = options.port ?? process.env.MINDOS_WEB_PORT ?? DEFAULT_PORT;
  const command = options.command ?? 'mindos';
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const url = `http://${hostname}:${port}`;
  const args = ['serve', '--port', String(port)];
  if (options.verbose) args.push('--verbose');

  const serverSpawn = resolveMindosServerSpawn(command);
  const proc = childProcess.spawn(serverSpawn.command, args, {
    env: {
      ...process.env,
      ...options.env,
      MINDOS_WEB_HOST: hostname,
      MINDOS_WEB_PORT: String(port),
      ...(options.token ? { MINDOS_AUTH_TOKEN: options.token } : {}),
    },
    shell: serverSpawn.shell,
    stdio: 'ignore',
  });

  const abortHandler = () => {
    void terminateProcess(proc);
  };
  options.signal?.addEventListener('abort', abortHandler, { once: true });
  const failure = createProcessFailureWaiter(proc);

  try {
    await Promise.race([
      waitForHealth(
        createMindosClient({ baseUrl: url, token: options.token }),
        timeoutMs,
        pollIntervalMs,
        options.signal,
      ),
      failure.promise,
    ]);
  } catch (error) {
    await terminateProcess(proc);
    throw error;
  } finally {
    failure.cleanup();
    options.signal?.removeEventListener('abort', abortHandler);
  }

  return {
    url,
    process: proc,
    close() {
      return terminateProcess(proc);
    },
  };
}
