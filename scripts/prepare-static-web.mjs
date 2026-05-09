#!/usr/bin/env node
/**
 * Materialize a static Web artifact for the product server.
 *
 * This is a transition build step: Next can still be used at build time to
 * render the shell, but the published runtime can serve static-web/index.html
 * directly through @geminilight/mindos/server without starting Next.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = resolve(root, 'packages', 'web');
const productRoot = resolve(root, 'packages', 'mindos');
const webStandaloneDir = resolve(appDir, '.next', 'standalone');
const webStandaloneServer = resolve(webStandaloneDir, 'server.js');
const nextStaticDir = resolve(appDir, '.next', 'static');
const publicDir = resolve(appDir, 'public');
const destDir = resolve(productRoot, 'static-web');

const routes = [
  { route: '/', file: 'index.html' },
  { route: '/wiki', file: 'wiki/index.html' },
  { route: '/help', file: 'help/index.html' },
  { route: '/setup?force=1', file: 'setup/index.html' },
];

if (!existsSync(webStandaloneServer)) {
  console.error(
    `[prepare-static-web] Missing ${webStandaloneServer}\n`
    + 'Run: pnpm --filter @mindos/web run build'
  );
  process.exit(1);
}

if (!existsSync(nextStaticDir)) {
  console.error(`[prepare-static-web] Missing ${nextStaticDir}`);
  process.exit(1);
}

const tempRoot = mkdtempSync(resolve(tmpdir(), 'mindos-static-web-'));
const tempHome = resolve(tempRoot, 'home');
const tempMind = resolve(tempRoot, 'mind');
mkdirSync(resolve(tempHome, '.mindos'), { recursive: true });
mkdirSync(tempMind, { recursive: true });
writeFileSync(resolve(tempMind, 'README.md'), '# MindOS\n\nStatic shell build fixture.\n', 'utf-8');
writeFileSync(resolve(tempHome, '.mindos', 'config.json'), JSON.stringify({
  ai: { activeProvider: '', providers: [] },
  mindRoot: tempMind,
  setupPending: false,
}, null, 2), 'utf-8');

const port = await getFreePort();
const child = spawn(process.execPath, [webStandaloneServer], {
  cwd: webStandaloneDir,
  env: {
    ...process.env,
    HOME: tempHome,
    MIND_ROOT: tempMind,
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 30_000);

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(nextStaticDir, resolve(destDir, '_next', 'static'), { recursive: true, dereference: true });
  if (existsSync(publicDir)) {
    cpSync(publicDir, destDir, {
      recursive: true,
      dereference: true,
      filter: (src) => !src.includes('/node_modules/'),
    });
  }

  const rendered = [];
  for (const item of routes) {
    const html = await fetchHtml(`http://127.0.0.1:${port}${item.route}`);
    const filePath = resolve(destDir, item.file);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, html, 'utf-8');
    rendered.push(item);
  }

  const version = JSON.parse(readFileSync(resolve(productRoot, 'package.json'), 'utf-8')).version;
  writeFileSync(resolve(destDir, '.mindos-build-version'), version, 'utf-8');
  writeFileSync(resolve(destDir, 'static-web-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    source: 'next-standalone-snapshot',
    version,
    routes: rendered,
    assets: ['_next/static', 'public'],
  }, null, 2)}\n`, 'utf-8');

  if (!existsSync(resolve(destDir, 'index.html'))) {
    throw new Error('static-web/index.html was not written');
  }

  console.log(`[prepare-static-web] OK - packages/mindos/static-web (${rendered.length} route snapshots, v${version})`);
} catch (error) {
  console.error(`[prepare-static-web] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  if (stdout.trim()) console.error(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  rmSync(tempRoot, { recursive: true, force: true });
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('Unable to allocate a local port'));
      });
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { headers: { 'accept-language': 'en' } });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { 'accept-language': 'en' } });
  if (!response.ok) throw new Error(`Snapshot ${url} failed with HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes('<html')) throw new Error(`Snapshot ${url} did not return HTML`);
  return html;
}
