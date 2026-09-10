import { createServer, type OutgoingHttpHeaders, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { createMindosApp } from './app.js';
import { installAgentRunLedgerBridge } from './events/ledger-bridge.js';
import { installRuntimeControlPlaneBridge } from './events/control-plane-bridge.js';
import { CORS_HEADERS } from './response.js';
import type { MindosRuntimeOptions } from './runtime.js';
import { createDefaultMindosHttpServices, type MindosHttpServices } from './services.js';
import { closeAllSessions as closeAllAcpSessions } from '../protocols/acp/session.js';
import { registerAcpShutdownHooks } from '../protocols/acp/shutdown.js';

function isBodyless(status: number): boolean {
  return status === 204 || status === 304;
}

function headersToRecord(headers: Headers): OutgoingHttpHeaders {
  const record: OutgoingHttpHeaders = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export {
  createDefaultMindosHttpServices,
  type DefaultMindosHttpServicesOptions,
  type MindosChannelServices,
  type MindosHttpServices,
} from './services.js';

export type MindosHttpServerOptions = {
  hostname?: string;
  port?: number;
  runtimeRoot?: string;
  staticRoot?: string;
  services?: MindosHttpServices;
  runtime?: MindosRuntimeOptions;
  syncDaemon?: MindosHttpServices['syncDaemon'];
};

export type MindosHttpServer = {
  server: Server;
  url: string;
  listen(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Node bootstrap for the Product Server: builds the Hono app from the route
 * table and mounts it on a plain `node:http` server so `bin/`, Desktop and the
 * tests keep working against the same `{ server, url, listen, close }` shape.
 */
export function createMindosHttpServer(options: MindosHttpServerOptions = {}): MindosHttpServer {
  const hostname = options.hostname ?? process.env.MINDOS_WEB_HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.MINDOS_WEB_PORT || 3456);
  const ownsServices = !options.services;
  const services = options.services ?? createDefaultMindosHttpServices({
    ...options.runtime,
    runtimeRoot: options.runtimeRoot,
    staticRoot: options.staticRoot,
    syncDaemon: options.syncDaemon,
  });
  // Agent run ledger events reach GET /api/events through the process bus.
  if (services.events) {
    installAgentRunLedgerBridge(services.events);
    installRuntimeControlPlaneBridge(services.events);
  }
  // ACP agents are children of this server process: make sure they die with it.
  registerAcpShutdownHooks();

  const app = createMindosApp({ services, runtimeRoot: options.runtimeRoot, auth: 'contract', staticFallback: true });
  const listener = getRequestListener(async (request, env) => {
    const response = await app.fetch(request, env);
    // @hono/node-server stamps `content-type: text/plain` on every response
    // that lacks one. On a 304 that would let the browser overwrite the cached
    // JSON content type, so bodyless responses are written to the socket here
    // with exactly the headers the app produced.
    if (isBodyless(response.status) && response.body === null && 'outgoing' in env) {
      env.outgoing.writeHead(response.status, headersToRecord(response.headers));
      env.outgoing.end();
      return RESPONSE_ALREADY_SENT;
    }
    return response;
  }, {
    // Keep the process's global Request/Response untouched: the same process
    // hosts provider SDKs and the MCP transport that rely on the standard ones.
    overrideGlobalObjects: false,
    errorHandler: (error) => {
      // Last line of defence: Hono's onError already turns handler failures
      // into JSON; anything reaching here escaped the app (e.g. a body stream
      // failing after the response was committed). Without this the rejection
      // would be unhandled and terminate the process under Node's default policy.
      console.error('[mindos-server] request handler failed after response commit:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    },
  });
  const server = createServer(listener);

  return {
    server,
    url: `http://${hostname}:${port}`,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, hostname, () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (ownsServices) services.dispose?.();
          // Sessions still open belong to this process; close them gracefully
          // (session/close under its deadline, then kill) before reporting.
          void closeAllAcpSessions().catch(() => {}).finally(() => {
            if (error) reject(error);
            else resolve();
          });
        });
      });
    },
  };
}
