#!/usr/bin/env node
/**
 * Smoke-test Next standalone server: merge static/public, spawn server.js, GET /api/health.
 * Catches missing serverExternalPackages / file-trace gaps (MODULE_NOT_FOUND at startup).
 *
 * Run from repo root after: pnpm --filter @mindos/web run build
 *   node scripts/verify-standalone.mjs
 *
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import { spawn } from 'child_process';
import http from 'http';
import { createServer as createTcpServer } from 'net';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { materializeStandaloneAssets } from '../packages/desktop/scripts/prepare-mindos-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'packages', 'web');
const serverJs = path.join(appDir, '.next', 'standalone', 'server.js');

if (!existsSync(serverJs)) {
  console.error(
    `[verify-standalone] Missing ${serverJs}\nBuild first: pnpm --filter @mindos/web run build`
  );
  process.exit(1);
}

try {
  materializeStandaloneAssets(appDir);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

async function allocateFreePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const allocatedPort = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (allocatedPort >= 1024) resolve(allocatedPort);
        else reject(new Error(`Invalid allocated test port: ${allocatedPort}`));
      });
    });
  });
}

const port = await allocateFreePort();
const nodeBin = process.execPath;
const localOrigin = `http://127.0.0.1:${port}`;
const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

function resolveLocalRedirect(currentUrl, location) {
  if (!location) return null;
  const redirectUrl = new URL(location, currentUrl);
  if (redirectUrl.origin !== localOrigin) {
    throw new Error(`Refusing external redirect from ${currentUrl.href} to ${redirectUrl.href}`);
  }
  return redirectUrl;
}

function waitHttpOk(pathname, timeoutMs, validate = () => true, options = {}) {
  const maxRedirects = options.maxRedirects ?? 0;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const requestUrl = (url, redirectsRemaining) => {
      const req = http.get(url, { timeout: 2000 }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode === 200 && validate(body)) {
            resolve();
            return;
          }

          if (redirectStatusCodes.has(res.statusCode ?? 0)) {
            if (redirectsRemaining <= 0) {
              reject(new Error(`Too many redirects while waiting for ${localOrigin}${pathname}`));
              return;
            }

            try {
              const redirectUrl = resolveLocalRedirect(url, res.headers.location);
              if (redirectUrl) {
                requestUrl(redirectUrl, redirectsRemaining - 1);
                return;
              }
            } catch (error) {
              reject(error);
              return;
            }
          }

          setTimeout(tick, 300);
        });
      });
      req.on('error', () => {
        setTimeout(tick, 300);
      });
      req.on('timeout', () => {
        req.destroy();
        setTimeout(tick, 300);
      });
    };

    const tick = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for ${localOrigin}${pathname}`));
        return;
      }
      requestUrl(new URL(pathname, localOrigin), maxRedirects);
    };
    tick();
  });
}

function waitHealth(timeoutMs) {
  return waitHttpOk('/api/health', timeoutMs, (body) => {
    try {
      const j = JSON.parse(body);
      return j.ok === true && j.service === 'mindos';
    } catch {
      return false;
    }
  });
}

function waitMcpAgents(timeoutMs) {
  return waitHttpOk('/api/mcp/agents', timeoutMs, (body) => {
    try {
      const j = JSON.parse(body);
      return Array.isArray(j.agents) && j.agents.length > 0;
    } catch {
      return false;
    }
  });
}

let stderr = '';
const child = spawn(nodeBin, [serverJs], {
  cwd: appDir,
  env: {
    ...process.env,
    AUTH_TOKEN: '',
    NODE_ENV: 'production',
    PORT: String(port),
    /** Next binds to machine hostname by default; Desktop health checks use 127.0.0.1 */
    HOSTNAME: '127.0.0.1',
    WEB_PASSWORD: '',
    WEB_SESSION_SECRET: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stderr?.on('data', (c) => {
  stderr += c.toString();
});

function killChild() {
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

async function main() {
  try {
    await waitHealth(90_000);
    await waitMcpAgents(30_000);
    await waitHttpOk(
      '/',
      30_000,
      (body) => body.includes('MindOS') || body.includes('__next'),
      { maxRedirects: 5 }
    );
    console.log(`[verify-standalone] OK (port ${port})`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    if (stderr.trim()) console.error('--- server stderr (tail) ---\n', stderr.slice(-4000));
    return 1;
  } finally {
    killChild();
    await new Promise((r) => setTimeout(r, 500));
  }
}

child.on('error', (err) => {
  console.error('[verify-standalone] spawn failed:', err.message);
  process.exit(1);
});

main().then((code) => process.exit(code));
