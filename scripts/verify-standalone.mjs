#!/usr/bin/env node
/**
 * Smoke-test Next standalone server: merge static/public, spawn server.js, GET /api/health.
 * Catches missing serverExternalPackages / file-trace gaps (MODULE_NOT_FOUND at startup).
 *
 * Run from repo root after: cd app && ./node_modules/.bin/next build
 *   node scripts/verify-standalone.mjs
 *
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import { spawn } from 'child_process';
import http from 'http';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { materializeStandaloneAssets } from '../desktop/scripts/prepare-mindos-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const serverJs = path.join(appDir, '.next', 'standalone', 'server.js');

if (!existsSync(serverJs)) {
  console.error(
    `[verify-standalone] Missing ${serverJs}\nBuild first: cd app && ./node_modules/.bin/next build`
  );
  process.exit(1);
}

try {
  materializeStandaloneAssets(appDir);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const port = 31000 + Math.floor(Math.random() * 5000);
const nodeBin = process.execPath;

function waitHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for http://127.0.0.1:${port}/api/health`));
        return;
      }
      const req = http.get(
        `http://127.0.0.1:${port}/api/health`,
        { timeout: 2000 },
        (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const j = JSON.parse(body);
                if (j.ok === true && j.service === 'mindos') {
                  resolve();
                  return;
                }
              } catch {
                /* fall through */
              }
            }
            setTimeout(tick, 300);
          });
        }
      );
      req.on('error', () => {
        setTimeout(tick, 300);
      });
      req.on('timeout', () => {
        req.destroy();
        setTimeout(tick, 300);
      });
    };
    tick();
  });
}

let stderr = '';
const child = spawn(nodeBin, [serverJs], {
  cwd: appDir,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    /** Next binds to machine hostname by default; Desktop health checks use 127.0.0.1 */
    HOSTNAME: '127.0.0.1',
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
