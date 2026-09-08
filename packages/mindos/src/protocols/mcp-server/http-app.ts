/**
 * MindOS MCP Server — Streamable HTTP transport on Hono.
 *
 * Replaces the SDK's Express helper: the same bearer gate, DNS-rebinding host
 * validation for loopback binds, per-session transport + McpServer with an
 * idle sweeper, and the `/api/health` probe, expressed against Web-standard
 * `Request`/`Response` via `WebStandardStreamableHTTPServerTransport` and
 * served by `@hono/node-server`.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  formatForcedLoopbackWarning,
  isAuthorizedBearer,
  isLoopbackHost,
  resolveMcpBindHost,
  validateLocalhostHostHeader,
  type McpBindHostDecision,
} from './http-security.js';
import { createMcpSessionRegistry, isJsonRpcInitializeRequest, type McpSessionRegistry } from './session-registry.js';

export const MCP_DEFAULT_ENDPOINT = '/mcp';

export type McpHttpSessions = McpSessionRegistry<WebStandardStreamableHTTPServerTransport, McpServer>;

export type McpHttpAppOptions = {
  /** Bearer token clients must present on the MCP endpoint. Unset means no auth (loopback only). */
  authToken?: string;
  /** JSON-RPC endpoint path. Default `/mcp`. */
  endpoint?: string;
  /** Interface the server is bound to; loopback binds get Host-header validation. */
  bindHost: string;
  createMcpServer: () => McpServer;
  sessions?: McpHttpSessions;
  /** Diagnostic sink (stderr in production, silent in tests). */
  log?: (message: string) => void;
};

export type McpHttpApp = {
  app: Hono;
  sessions: McpHttpSessions;
};

function jsonRpcError(status: number, message: string, withId: boolean) {
  return {
    status,
    body: {
      jsonrpc: '2.0' as const,
      error: { code: -32000, message },
      ...(withId ? { id: null } : {}),
    },
  };
}

export function createMcpHttpApp(options: McpHttpAppOptions): McpHttpApp {
  const endpoint = options.endpoint ?? MCP_DEFAULT_ENDPOINT;
  const sessions = options.sessions ?? createMcpSessionRegistry<WebStandardStreamableHTTPServerTransport, McpServer>();
  const log = options.log ?? ((message: string) => console.error(message));
  const app = new Hono();

  if (isLoopbackHost(options.bindHost)) {
    app.use('*', async (c, next) => {
      const verdict = validateLocalhostHostHeader(c.req.header('host'));
      if (!verdict.ok) {
        const { status, body } = jsonRpcError(403, verdict.message, true);
        return c.json(body, status as 403);
      }
      await next();
    });
  } else if (options.bindHost === '0.0.0.0' || options.bindHost === '::') {
    log(`Warning: Server is binding to ${options.bindHost} without DNS rebinding protection. `
      + 'Consider restricting the bind host, or use authentication to protect your server.');
  }

  app.get('/api/health', (c) => c.json({ ok: true, service: 'mindos' }));

  app.all(endpoint, async (c) => {
    const request = c.req.raw;
    if (options.authToken && !isAuthorizedBearer(c.req.header('authorization'), options.authToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionId = c.req.header('mcp-session-id');
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        const { status, body } = jsonRpcError(404, 'Session not found', false);
        return c.json(body, status as 404);
      }
      sessions.touch(sessionId);
      return session.transport.handleRequest(request);
    }

    // Only a JSON-RPC initialize may open a session. Anything else without a
    // session id is a protocol error; reject before allocating a McpServer.
    const parsedBody = request.method === 'POST' ? await request.clone().json().catch(() => undefined) : undefined;
    if (request.method !== 'POST' || !isJsonRpcInitializeRequest(parsedBody)) {
      const { status, body } = jsonRpcError(400, 'Bad Request: Mcp-Session-Id header is required for non-initialize requests', true);
      return c.json(body, status as 400);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const server = options.createMcpServer();

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
      log(`[MCP] Session ${sid?.slice(0, 8)} closed (${sessions.size} active)`);
    };

    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });

    const sid = transport.sessionId;
    if (sid) {
      sessions.add(sid, transport, server);
      const client = server.server.getClientVersion();
      const clientLabel = client?.name ? ` (${client.name})` : '';
      log(`[MCP] New session ${sid.slice(0, 8)}${clientLabel} (${sessions.size} active)`);
    }
    return response;
  });

  return { app, sessions };
}

export type StartMcpHttpServerOptions = Omit<McpHttpAppOptions, 'bindHost'> & {
  /** Host asked for by the operator (MCP_HOST); forced back to loopback without a token. */
  requestedHost?: string | null;
  port: number;
};

export type McpHttpServerHandle = McpHttpApp & {
  server: Server;
  bind: McpBindHostDecision;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
};

/**
 * Binds the MCP HTTP app on a Node server. Resolves the bind host with the
 * same rule the CLI launcher uses (no token → loopback), starts the idle
 * session sweeper, and resolves once listening (or rejects with the listen
 * error, e.g. EADDRINUSE).
 */
export async function startMcpHttpServer(options: StartMcpHttpServerOptions): Promise<McpHttpServerHandle> {
  const log = options.log ?? ((message: string) => console.error(message));
  const bind = resolveMcpBindHost(options.requestedHost, options.authToken);
  const warning = formatForcedLoopbackWarning(bind);
  if (warning) log(warning);

  const { app, sessions } = createMcpHttpApp({ ...options, bindHost: bind.host, log });
  const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });
  const server = createServer(listener);

  const stopSweeper = sessions.startSweeper(undefined, (closed) => {
    log(`[MCP] Closed ${closed.length} idle session(s) (${sessions.size} active)`);
  });
  server.once('close', stopSweeper);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, bind.host);
  });

  const address = server.address();
  const port = address && typeof address !== 'string' ? address.port : options.port;
  const displayHost = bind.host === '0.0.0.0' ? '127.0.0.1' : bind.host;

  return {
    app,
    sessions,
    server,
    bind,
    host: bind.host,
    port,
    url: `http://${displayHost}:${port}`,
    async close() {
      // Open SSE responses would otherwise keep `server.close` pending.
      await sessions.closeAll();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      });
    },
  };
}
