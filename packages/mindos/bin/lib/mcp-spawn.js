import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CONFIG_PATH } from './constants.js';
import { bold, red, yellow } from './colors.js';
import { ensureMcpBundle, MCP_BUNDLE, MCP_DIR } from './mcp-build.js';

function runtimeJsExecutor() {
  return process.env.MINDOS_BINARY_EXECUTOR || process.execPath;
}

const LOOPBACK_HOST = '127.0.0.1';
const ANY_HOST = '0.0.0.0';

function isLoopbackHost(host) {
  const value = String(host).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return false;
  if (value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  return value.startsWith('::ffff:127.');
}

/**
 * Mirror of src/protocols/mcp-server/http-security.ts#resolveMcpBindHost.
 * The MCP HTTP server only enforces auth when AUTH_TOKEN is set, so an
 * unauthenticated server must never be bound to a LAN interface, even when
 * MCP_HOST explicitly asks for one.
 *
 * @param {string | undefined | null} requestedHost
 * @param {string | undefined | null} authToken
 * @returns {{ host: string, forcedLoopback: boolean, requestedHost?: string }}
 */
export function resolveMcpBindHost(requestedHost, authToken) {
  const requested = typeof requestedHost === 'string' && requestedHost.trim() ? requestedHost.trim() : undefined;
  const authenticated = typeof authToken === 'string' && authToken.length > 0;
  if (authenticated) return { host: requested ?? ANY_HOST, forcedLoopback: false, requestedHost: requested };
  if (!requested) return { host: LOOPBACK_HOST, forcedLoopback: false };
  if (isLoopbackHost(requested)) return { host: requested, forcedLoopback: false, requestedHost: requested };
  return { host: LOOPBACK_HOST, forcedLoopback: true, requestedHost: requested };
}

export function spawnMcp(verbose = false) {
  const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
  const webPort = process.env.MINDOS_WEB_PORT || '3456';

  try {
    ensureMcpBundle();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${message}\n` +
      `This MindOS installation may be corrupted. Try: npm install -g @geminilight/mindos@latest`,
    );
  }

  let configAuthToken;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    configAuthToken = cfg.authToken;
  } catch { /* config may not exist yet */ }

  const authToken = configAuthToken || process.env.AUTH_TOKEN;
  const bind = resolveMcpBindHost(process.env.MCP_HOST, authToken);
  if (bind.forcedLoopback) {
    console.error(yellow(`  MCP: no auth token configured; binding MCP HTTP to ${bind.host} instead of ${bind.requestedHost}. Run \`mindos onboard\` to set a token before exposing MCP on the network.`));
  }

  const env = {
    ...process.env,
    MCP_TRANSPORT: 'http',
    MCP_PORT: mcpPort,
    MCP_HOST: bind.host,
    MINDOS_URL: process.env.MINDOS_URL || `http://127.0.0.1:${webPort}`,
    ...(configAuthToken ? { AUTH_TOKEN: configAuthToken } : {}),
    ...(verbose ? { MCP_VERBOSE: '1' } : {}),
  };
  const child = spawn(runtimeJsExecutor(), [MCP_BUNDLE], {
    cwd: MCP_DIR,
    stdio: 'inherit',
    env,
  });
  child.on('error', (err) => {
    if (err.message.includes('EADDRINUSE')) {
      console.error(`\n${red('\u2718')} ${bold(`MCP port ${mcpPort} is already in use`)}`);
      console.error(`  ${'Run:'} mindos stop\n`);
    } else {
      console.error(red('MCP server error:'), err.message);
    }
  });
  return child;
}
