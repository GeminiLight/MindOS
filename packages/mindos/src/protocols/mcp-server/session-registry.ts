/**
 * Session bookkeeping for the MCP Streamable HTTP transport.
 *
 * The SDK only fires `transport.onclose` on an explicit DELETE, so clients
 * that simply drop their connection and re-initialize would otherwise leak a
 * full McpServer per reconnect. This registry records `lastSeenAt` on every
 * request and lets a periodic sweeper close idle sessions.
 *
 * Pure (no Express / SDK imports) so it can be unit-tested with a fake clock.
 */

export const MCP_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const MCP_SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

export interface McpSessionTransportLike {
  close(): Promise<void> | void;
}

export interface McpSessionEntry<T extends McpSessionTransportLike, S> {
  transport: T;
  server: S;
  lastSeenAt: number;
}

export interface McpSessionRegistryOptions {
  idleTimeoutMs?: number;
  now?: () => number;
}

export interface McpSessionRegistry<T extends McpSessionTransportLike, S> {
  readonly size: number;
  has(sessionId: string): boolean;
  get(sessionId: string): McpSessionEntry<T, S> | undefined;
  add(sessionId: string, transport: T, server: S): void;
  /** Refresh `lastSeenAt`; returns false when the session is unknown. */
  touch(sessionId: string): boolean;
  delete(sessionId: string): boolean;
  /** Close and drop every session idle for longer than the timeout. Returns the closed ids. */
  sweep(): Promise<string[]>;
  /** Close and drop every session regardless of age (server shutdown). Returns the closed ids. */
  closeAll(): Promise<string[]>;
  /** Start an unref'd interval sweeper; returns a stop function. */
  startSweeper(intervalMs?: number, onSwept?: (closedIds: string[]) => void): () => void;
}

export function createMcpSessionRegistry<T extends McpSessionTransportLike, S>(
  options: McpSessionRegistryOptions = {},
): McpSessionRegistry<T, S> {
  const idleTimeoutMs = options.idleTimeoutMs ?? MCP_SESSION_IDLE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, McpSessionEntry<T, S>>();

  async function closeSessions(ids: string[]): Promise<string[]> {
    for (const id of ids) {
      const entry = sessions.get(id);
      // Drop the map entry first so a transport.onclose callback that also
      // deletes by id is a harmless no-op.
      sessions.delete(id);
      try {
        await entry?.transport.close();
      } catch {
        // Best-effort: the client is gone anyway.
      }
    }
    return ids;
  }

  const registry: McpSessionRegistry<T, S> = {
    get size() {
      return sessions.size;
    },
    has(sessionId) {
      return sessions.has(sessionId);
    },
    get(sessionId) {
      return sessions.get(sessionId);
    },
    add(sessionId, transport, server) {
      sessions.set(sessionId, { transport, server, lastSeenAt: now() });
    },
    touch(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return false;
      entry.lastSeenAt = now();
      return true;
    },
    delete(sessionId) {
      return sessions.delete(sessionId);
    },
    async sweep() {
      const cutoff = now() - idleTimeoutMs;
      const stale: string[] = [];
      for (const [id, entry] of sessions) {
        if (entry.lastSeenAt < cutoff) stale.push(id);
      }
      return closeSessions(stale);
    },
    async closeAll() {
      return closeSessions([...sessions.keys()]);
    },
    startSweeper(intervalMs = MCP_SESSION_SWEEP_INTERVAL_MS, onSwept) {
      const timer = setInterval(() => {
        registry.sweep()
          .then((closed) => {
            if (closed.length > 0) onSwept?.(closed);
          })
          .catch(() => {});
      }, intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };

  return registry;
}

function isInitializeMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const record = message as Record<string, unknown>;
  return record.jsonrpc === '2.0' && record.method === 'initialize';
}

/**
 * True when the parsed request body is a JSON-RPC `initialize` request (or a
 * batch containing one). Only such requests may create a new session.
 */
export function isJsonRpcInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) return body.some(isInitializeMessage);
  return isInitializeMessage(body);
}
