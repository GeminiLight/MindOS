/**
 * MindOS MCP Server — entrypoint
 *
 * Pure protocol adapter: maps MCP tools to App REST API calls via fetch.
 * Zero business logic — all operations delegated to the App.
 *
 * Transport modes:
 *   Streamable HTTP (default, Hono + WebStandardStreamableHTTPServerTransport):
 *     mindos mcp
 *
 *   stdio:
 *     MCP_TRANSPORT=stdio mindos mcp
 *
 * Env contract: MCP_TRANSPORT, MCP_HOST, MCP_PORT, MCP_ENDPOINT, MINDOS_URL, AUTH_TOKEN.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveMcpBindHost } from "./http-security.js";
import { startMcpHttpServer } from "./http-app.js";
import { AUTH_TOKEN, BASE_URL, createMcpServer } from "./tools.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const MCP_TRANSPORT  = process.env.MCP_TRANSPORT   ?? "http";    // "http" | "stdio"
// Without an auth token nothing guards the HTTP endpoint, so the bind host is
// forced to loopback regardless of MCP_HOST (see resolveMcpBindHost). Resolved
// here only for error messages; startMcpHttpServer applies the same rule.
const MCP_HOST       = resolveMcpBindHost(process.env.MCP_HOST, AUTH_TOKEN).host;
const MCP_PORT       = parseInt(process.env.MCP_PORT ?? "8781", 10);
const MCP_ENDPOINT   = process.env.MCP_ENDPOINT    ?? "/mcp";

interface NodeListenError extends Error {
  code?: string;
  port?: number;
}

function isNodeListenError(error: unknown): error is NodeListenError {
  if (!(error instanceof Error)) return false;
  const maybeListenError = error as NodeListenError;
  return typeof maybeListenError.code === 'string'
    && (typeof maybeListenError.port === 'number' || error.message.startsWith('listen '));
}

function formatMcpListenError(error: NodeListenError): string {
  const port = error.port ?? MCP_PORT;
  if (error.code === 'EADDRINUSE') {
    return `MCP HTTP port ${port} is already in use on ${MCP_HOST}. Stop the existing server or set MINDOS_MCP_PORT to another port.`;
  }
  return `Failed to start MindOS MCP HTTP server on ${MCP_HOST}:${port}: ${error.message}`;
}

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  if (MCP_TRANSPORT === "http") {
    const handle = await startMcpHttpServer({
      requestedHost: process.env.MCP_HOST,
      port: MCP_PORT,
      authToken: AUTH_TOKEN,
      endpoint: MCP_ENDPOINT,
      createMcpServer,
    });
    console.error(`MindOS MCP server (HTTP) listening on ${handle.url}${MCP_ENDPOINT}`);
    console.error(`API backend: ${BASE_URL}`);

    // Detect parent-exit via stdin EOF — but only when stdin is a real pipe
    // from a parent process (e.g. Desktop/Electron).  Under launchd/systemd,
    // stdin is /dev/null which emits EOF immediately and would kill the server.
    const launchedByDaemon =
      process.env.LAUNCHED_BY_LAUNCHD === '1' || !!process.env.INVOCATION_ID;
    if (!process.stdin.isTTY && !launchedByDaemon) {
      process.stdin.resume();
      process.stdin.on('end', () => {
        console.error('[MindOS MCP] Parent process exited (stdin closed), shutting down');
        handle.server.close();
        setTimeout(() => process.exit(0), 1000);
      });
      process.stdin.on('error', () => {});
    }
  } else {
    // ── stdio mode ───────────────────────────────────────────────────────
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`MindOS MCP server started (stdio, API: ${BASE_URL})`);
  }
}

main().catch((e) => {
  if (isNodeListenError(e)) console.error(formatMcpListenError(e));
  else console.error("Fatal:", e);
  process.exit(1);
});
