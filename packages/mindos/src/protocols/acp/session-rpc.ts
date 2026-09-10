/**
 * ACP session RPC helpers — the JSON-RPC calls that open and close an agent
 * connection, plus the deadlines and diagnostics wrapped around them.
 */

import type { ClientSideConnection, McpServer } from '@agentclientprotocol/sdk';
import type {
  AcpAgentCapabilities,
  AcpAuthMethod,
  AcpRegistryEntry,
  AcpSessionMcpServerSummary,
} from './types.js';
import { ACP_ERRORS, isAcpCapabilitySupported } from './types.js';
import {
  spawnAndConnect,
  killAgent,
  type AcpConnection,
  type AcpLaunchOptions,
  type AcpPermissionMode,
  type AcpProcess,
} from './subprocess.js';
import {
  buildAcpSessionMcpInheritancePlan,
  type AcpSessionMcpConfigLike,
} from './mcp-session-inheritance.js';
import { rememberAcpHandshakeHealth } from './handshake-health.js';
import { parseAgentCapabilities, parseAuthMethods } from './session-parsers.js';

/* ── Options and deadlines ────────────────────────────────────────────── */

export type AcpRpcTimeouts = {
  /** `initialize` */
  initialize: number;
  /** `authenticate` */
  authenticate: number;
  /** `session/new` and `session/load` */
  sessionOpen: number;
  /** `session/list` */
  sessionList: number;
  /** `session/close`; the process is killed once this elapses */
  close: number;
};

export const DEFAULT_ACP_RPC_TIMEOUTS: AcpRpcTimeouts = {
  initialize: 15_000,
  authenticate: 15_000,
  sessionOpen: 30_000,
  sessionList: 30_000,
  close: 5_000,
};

export interface AcpSessionOptions extends AcpLaunchOptions {
  clientVersion?: string;
  inheritMcpServers?: boolean;
  mcpConfig?: AcpSessionMcpConfigLike | null;
  mcpServers?: McpServer[];
  /** Aborts whichever handshake RPC is in flight and kills the agent process. */
  signal?: AbortSignal;
  /** Per-RPC deadlines; missing entries fall back to DEFAULT_ACP_RPC_TIMEOUTS. */
  timeouts?: Partial<AcpRpcTimeouts>;
  /**
   * Authenticate right after initialize: `true` uses the first method the
   * agent declares, a string names the method id. Without it MindOS only
   * authenticates when session/new or session/load answers -32000.
   */
  authenticate?: boolean | string;
}

export function resolveAcpRpcTimeouts(options?: Pick<AcpSessionOptions, 'timeouts'>): AcpRpcTimeouts {
  const resolved: AcpRpcTimeouts = { ...DEFAULT_ACP_RPC_TIMEOUTS };
  for (const key of Object.keys(DEFAULT_ACP_RPC_TIMEOUTS) as Array<keyof AcpRpcTimeouts>) {
    const value = options?.timeouts?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) resolved[key] = value;
  }
  return resolved;
}

export function abortReasonOf(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortedBy(signal: AbortSignal | undefined, error: unknown): boolean {
  return !!signal?.aborted && (error === signal.reason || (error instanceof DOMException && error.name === 'AbortError'));
}

export type AcpRpcCallOptions = {
  /** Wire method name used in the timeout message, e.g. `session/new`. */
  label: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Runs once when the deadline fires, before the rejection is delivered. */
  onTimeout?: () => void;
  /** Runs once when `signal` aborts (or was already aborted), before the rejection. */
  onAbort?: () => void;
};

/**
 * Run one JSON-RPC call under a deadline and an optional abort signal. The
 * SDK never times out on its own, so an agent that stops answering would
 * otherwise pin the session (and its admission slot) forever.
 */
export function callAcpRpc<T>(run: () => Promise<T>, options: AcpRpcCallOptions): Promise<T> {
  const { label, timeoutMs, signal } = options;
  if (signal?.aborted) {
    options.onAbort?.();
    return Promise.reject(abortReasonOf(signal));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (deliver: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      deliver();
    };
    const onAbort = () => finish(() => {
      options.onAbort?.();
      reject(abortReasonOf(signal!));
    });
    const timer = setTimeout(() => finish(() => {
      options.onTimeout?.();
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    let pending: Promise<T>;
    try {
      pending = run();
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/* ── Error diagnosis ───────────────────────────────────────────────────── */

function diagnoseInitFailure(proc: AcpProcess, rawError: Error): string {
  const raw = rawError.message ?? '';
  const stderr = proc.spawnError ?? '';

  // ENOENT = spawn itself failed because the executable was not found
  if (raw.includes('ENOENT') || stderr.includes('ENOENT')) {
    return `Command not found: "${proc.agentId}". Verify it is installed and on your PATH, or set an absolute path in Agent settings.`;
  }

  // npx download failures (common when npm registry is unreachable, e.g. in China)
  if (stderr.includes('npm ERR!') || stderr.includes('ERR_SOCKET_TIMEOUT') || stderr.includes('ETIMEDOUT') || stderr.includes('ECONNREFUSED') || stderr.includes('Could not resolve host') || stderr.includes('FETCH_ERROR')) {
    return `Agent "${proc.agentId}" failed to download its ACP wrapper package. This usually means the npm registry is unreachable. Check your network connection and npm proxy settings. Stderr: ${stderr.slice(0, 300)}`;
  }

  // EPIPE = child process exited before we could write to stdin
  if (raw.includes('EPIPE')) {
    if (stderr) {
      return `Agent "${proc.agentId}" exited immediately: ${stderr}`;
    }
    return `Agent "${proc.agentId}" exited before initialization. Common causes: command not found in this environment (desktop apps often have a shorter PATH than your terminal), the agent does not support ACP mode, or authentication is required. Try running the agent command manually in a terminal to diagnose.`;
  }

  // Non-zero exit with stderr
  if (stderr) {
    return `Agent "${proc.agentId}" failed to start: ${stderr}`;
  }

  return `initialize failed: ${raw}`;
}

function getMindosVersion(options?: AcpSessionOptions): string {
  return options?.clientVersion ?? process.env.npm_package_version ?? '1.0.0';
}

function clientCapabilitiesForPermissionMode(mode: AcpPermissionMode | undefined) {
  const readonly = mode === 'readonly';
  return {
    fs: { readTextFile: true, writeTextFile: !readonly },
    terminal: !readonly,
  };
}

export function resolveSessionMcpInheritance(
  options: AcpSessionOptions | undefined,
  agentCapabilities: AcpAgentCapabilities | undefined,
): { servers: McpServer[]; summaries: AcpSessionMcpServerSummary[] } {
  if (options?.mcpServers) {
    return {
      servers: options.mcpServers,
      summaries: options.mcpServers.map((server) => ({
        name: server.name,
        type: 'type' in server && server.type === 'http'
          ? 'http'
          : 'type' in server && server.type === 'sse'
            ? 'sse'
            : 'type' in server && server.type === 'acp'
              ? 'acp'
              : 'stdio',
      })),
    };
  }
  if (options?.inheritMcpServers === false || !options?.mcpConfig) {
    return { servers: [], summaries: [] };
  }
  const plan = buildAcpSessionMcpInheritancePlan({
    config: options.mcpConfig,
    agentCapabilities,
  });
  return {
    servers: plan.servers,
    summaries: plan.summaries,
  };
}

/* ── initialize ───────────────────────────────────────────────────────── */

export type InitializedAcpConnection = {
  conn: AcpConnection;
  agentCapabilities?: AcpAgentCapabilities;
  authMethods?: AcpAuthMethod[];
  timeouts: AcpRpcTimeouts;
};

export async function initializeAcpConnection(
  entry: AcpRegistryEntry,
  options: AcpSessionOptions | undefined,
  startedAt: number,
): Promise<InitializedAcpConnection> {
  const timeouts = resolveAcpRpcTimeouts(options);
  const signal = options?.signal;
  // A turn cancelled before the handshake must not spawn a process at all.
  if (signal?.aborted) throw abortReasonOf(signal);

  const conn = spawnAndConnect(entry, options);

  let agentCapabilities: AcpAgentCapabilities | undefined;
  let authMethods: AcpAuthMethod[] | undefined;

  try {
    const initResult = await callAcpRpc(() => conn.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: clientCapabilitiesForPermissionMode(options?.permissionMode),
      clientInfo: { name: 'mindos', version: getMindosVersion(options) },
    }), { label: 'initialize', timeoutMs: timeouts.initialize, signal });

    agentCapabilities = parseAgentCapabilities(initResult.agentCapabilities);
    authMethods = parseAuthMethods(initResult.authMethods);
  } catch (err) {
    killAgent(conn.process);
    // A cancelled turn is not an agent health fact; surface the abort as-is.
    if (isAbortedBy(signal, err)) throw err;
    // Wait briefly for stderr/exit info before diagnosing.
    await new Promise(r => setTimeout(r, 200));
    const message = diagnoseInitFailure(conn.process, err as Error);
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'initialize',
      startedAt,
      message,
    });
    throw new Error(message);
  }

  const initialized: InitializedAcpConnection = { conn, agentCapabilities, authMethods, timeouts };

  // Only authenticate up front when the caller asked for it; the default is
  // to react to -32000 from session/new or session/load (see
  // openAcpSessionWithAuth), because an unsolicited authenticate can open a
  // browser or block on a login prompt for agents that do not need it.
  if (options?.authenticate) {
    try {
      await authenticateAcpConnection(entry, initialized, {
        methodId: typeof options.authenticate === 'string' ? options.authenticate : undefined,
        signal,
        startedAt,
      });
    } catch (err) {
      killAgent(conn.process);
      throw err;
    }
  }

  return initialized;
}

/* ── authenticate ─────────────────────────────────────────────────────── */

/**
 * The agent refused to open a session until the user signs in and MindOS
 * could not fix that on its own. Handshake health already carries the
 * `authenticate` stage so readiness can show the runtime as signed out.
 */
export class AcpAuthenticationError extends Error {
  readonly stage = 'authenticate' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AcpAuthenticationError';
  }
}

export function isAcpAuthRequiredError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === ACP_ERRORS.AUTH_REQUIRED.code;
}

/** `authenticate` under its deadline; failures are recorded as the `authenticate` stage. */
async function authenticateAcpConnection(
  entry: AcpRegistryEntry,
  initialized: InitializedAcpConnection,
  input: { methodId?: string; signal?: AbortSignal; startedAt: number; cause?: unknown },
): Promise<void> {
  const method = input.methodId
    ? initialized.authMethods?.find((candidate) => candidate.id === input.methodId)
    : initialized.authMethods?.[0];
  const fail = (message: string): never => {
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'authenticate',
      startedAt: input.startedAt,
      message,
      capabilities: initialized.agentCapabilities,
    });
    throw new AcpAuthenticationError(`${entry.id}: ${message}`);
  };

  if (!method) {
    const detail = input.cause instanceof Error && input.cause.message ? input.cause.message : ACP_ERRORS.AUTH_REQUIRED.message;
    const declared = initialized.authMethods?.map((candidate) => candidate.id).join(', ');
    fail(input.methodId
      ? `authentication method "${input.methodId}" is not offered by the agent${declared ? ` (available: ${declared})` : ''}`
      : `${detail}. Sign in to ${entry.name || entry.id} in a terminal, then retry.`);
  }

  try {
    await callAcpRpc(
      () => initialized.conn.connection.authenticate({ methodId: method!.id }),
      { label: 'authenticate', timeoutMs: initialized.timeouts.authenticate, signal: input.signal },
    );
  } catch (err) {
    if (isAbortedBy(input.signal, err)) throw err;
    fail(`authentication failed (${method!.name}): ${(err as Error).message ?? String(err)}`);
  }
}

/**
 * Run session/new or session/load; when the agent answers -32000, sign in
 * with its first declared method and retry once. Abort and authentication
 * failures propagate unchanged (the caller kills the process); any other
 * error is the caller's stage failure.
 */
export async function openAcpSessionWithAuth<T>(input: {
  entry: AcpRegistryEntry;
  initialized: InitializedAcpConnection;
  label: 'session/new' | 'session/load';
  signal?: AbortSignal;
  startedAt: number;
  run: () => Promise<T>;
}): Promise<T> {
  const { initialized, signal } = input;
  const call = () => callAcpRpc(input.run, {
    label: input.label,
    timeoutMs: initialized.timeouts.sessionOpen,
    signal,
  });
  try {
    return await call();
  } catch (err) {
    if (isAbortedBy(signal, err) || !isAcpAuthRequiredError(err)) throw err;
    await authenticateAcpConnection(input.entry, initialized, { signal, startedAt: input.startedAt, cause: err });
    return await call();
  }
}

/* ── close / cancel ───────────────────────────────────────────────────── */

/**
 * `session/close` under its deadline (only when the agent declares the
 * capability, otherwise the call would just error or hang), then the process
 * is killed regardless: an agent that ignores close must not keep its process
 * (or its slot) alive.
 */
export async function closeAgentConnection(
  conn: AcpConnection,
  wireSessionId: string,
  options: {
    closeAgentSession?: boolean;
    timeoutMs: number;
    capabilities?: AcpAgentCapabilities;
  },
): Promise<void> {
  if (!conn.process.alive) return;
  const supportsClose = isAcpCapabilitySupported(options.capabilities?.sessionCapabilities?.close);
  if (options.closeAgentSession !== false && supportsClose) {
    try {
      await callAcpRpc(
        () => closeAgentSession(conn.connection, wireSessionId),
        { label: 'session/close', timeoutMs: options.timeoutMs },
      );
    } catch {
      // Best-effort — the process is killed below either way.
    }
  }
  killAgent(conn.process);
}

function closeAgentSession(connection: ClientSideConnection, sessionId: string): Promise<unknown> {
  return connection.closeSession({ sessionId });
}

/**
 * Ask the agent to stop the in-flight turn. Used when our own prompt timeout
 * fires so the agent does not keep consuming tokens for a response nobody
 * will read. Never throws.
 */
export function cancelAgentPromptBestEffort(conn: AcpConnection, wireSessionId: string): void {
  try {
    void Promise.resolve(conn.connection.cancel({ sessionId: wireSessionId })).catch(() => {});
  } catch {
    // Best-effort cancel
  }
}
