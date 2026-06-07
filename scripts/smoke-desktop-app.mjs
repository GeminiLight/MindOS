#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const appPath = args.app ? resolve(args.app) : findPackagedApp();
const timeoutMs = Number(args.timeout ?? 60_000);
const webPort = Number(args.webPort ?? 3456);
const home = mkdtempSync(join(tmpdir(), 'mindos-desktop-smoke-home-'));
const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-desktop-smoke-mind-'));
const logPath = join(tmpdir(), `mindos-desktop-smoke-${Date.now()}.log`);
const seededConfigs = [];
const fatalPatterns = [
  /MCP bundle not found/i,
  /ERR_MODULE_NOT_FOUND/i,
  /Cannot find module/i,
  /Internal Error/i,
  /A JavaScript error occurred in the main process/i,
  /path\.join is not a function/i,
  /SyntaxError: Named export/i,
  /Named export 'expand' not found/i,
];

if (!appPath || !existsSync(appPath)) {
  console.error(`[smoke-desktop-app] Packaged app not found: ${appPath ?? '(auto)'}`);
  process.exit(1);
}

if (args.skipIfArchMismatch && isArchMismatch(appPath)) {
  console.log(`[smoke-desktop-app] SKIP arch mismatch for ${appPath}`);
  process.exit(0);
}

writeFileSync(join(mindRoot, 'README.md'), '# MindOS smoke\n', 'utf-8');
seedDesktopConfig();

const executable = resolveExecutable(appPath);
console.log(`[smoke-desktop-app] Launching ${executable}`);
console.log(`[smoke-desktop-app] Log: ${logPath}`);

const launchArgs = process.platform === 'linux' ? ['--no-sandbox'] : [];
const child = spawn(executable, launchArgs, {
  cwd: dirname(executable),
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPIMAGE_EXTRACT_AND_RUN: process.platform === 'linux' ? '1' : process.env.APPIMAGE_EXTRACT_AND_RUN,
    MIND_ROOT: mindRoot,
    MINDOS_WEB_PORT: String(webPort),
    MINDOS_MCP_PORT: String(args.mcpPort ?? 8781),
    MINDOS_RUNTIME_POLICY: 'bundled-only',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let log = '';
child.stdout.on('data', (chunk) => appendLog(chunk));
child.stderr.on('data', (chunk) => appendLog(chunk));
child.on('exit', (code, signal) => {
  appendLog(`\n[smoke-desktop-app] child exited code=${code} signal=${signal}\n`);
});

try {
  await waitForApp(timeoutMs);
  scanFatalLog();
  console.log(`[smoke-desktop-app] OK ${appPath}`);
} catch (error) {
  scanFatalLog(false);
  console.error(`[smoke-desktop-app] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  console.error(log.split('\n').slice(-120).join('\n'));
  process.exitCode = 1;
} finally {
  terminateChild();
  restoreSeededConfigs();
  rmSync(home, { recursive: true, force: true });
  rmSync(mindRoot, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}

async function waitForApp(timeout) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    if (child.exitCode !== null) {
      throw new Error(`Desktop app exited before health check passed (code ${child.exitCode})`);
    }
    try {
      const port = currentWebPort();
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (health.ok) {
        const root = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'follow' });
        const html = await root.text();
        if (!root.ok) throw new Error(`root/login returned HTTP ${root.status}`);
        if (!html.includes('<html') || !html.includes('MindOS')) {
          throw new Error('root/login did not return the MindOS HTML shell');
        }
        return;
      }
      lastError = new Error(`health HTTP ${health.status}`);
    } catch (error) {
      lastError = error;
    }
    scanFatalLog(false);
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw lastError ?? new Error(`Timed out waiting for http://127.0.0.1:${webPort}/api/health`);
}

function currentWebPort() {
  const readyMatch = /\(web port (\d+), mcp port/.exec(log);
  if (readyMatch) return Number(readyMatch[1]);

  const localMatch = /Local:\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(log);
  if (localMatch) return Number(localMatch[1]);

  return webPort;
}

function appendLog(chunk) {
  log += chunk.toString();
  writeFileSync(logPath, log);
}

function seedDesktopConfig() {
  const config = JSON.stringify({
    desktopMode: 'local',
    mindRoot,
    setupPending: false,
    port: webPort,
    mcpPort: Number(args.mcpPort ?? 8781),
  }, null, 2);

  seedConfigPath(join(home, '.mindos', 'config.json'), config);
  // Electron's app.getPath('home') can resolve to the OS account home instead
  // of the HOME env passed to child_process.spawn, especially on macOS runners.
  seedConfigPath(join(homedir(), '.mindos', 'config.json'), config);
}

function seedConfigPath(configPath, contents) {
  if (seededConfigs.some((entry) => entry.configPath === configPath)) return;
  const configDir = dirname(configPath);
  const previous = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : null;
  seededConfigs.push({ configPath, previous });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, contents, 'utf-8');
}

function restoreSeededConfigs() {
  for (const { configPath, previous } of seededConfigs.reverse()) {
    try {
      if (previous === null) rmSync(configPath, { force: true });
      else writeFileSync(configPath, previous, 'utf-8');
    } catch {
      // Best effort only: CI homes are disposable, and local runs should not fail
      // after the app itself has already been validated.
    }
  }
}

function scanFatalLog(throwOnMatch = true) {
  for (const pattern of fatalPatterns) {
    if (pattern.test(log)) {
      if (throwOnMatch) throw new Error(`fatal log pattern matched: ${pattern}`);
      process.exitCode = 1;
    }
  }
}

function resolveExecutable(app) {
  if (process.platform === 'darwin' && app.endsWith('.app')) {
    const name = app.split('/').pop()?.replace(/\.app$/, '') ?? 'MindOS';
    return join(app, 'Contents', 'MacOS', name);
  }
  return app;
}

function terminateChild() {
  const pid = child.pid;
  try {
    child.stdout?.destroy();
    child.stderr?.destroy();
  } catch {
    // ignore cleanup errors
  }
  try {
    if (pid && process.platform !== 'win32') process.kill(-pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    // already exited
  }
  try {
    if (pid && process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    // already exited
  }
  child.unref();
}

function findPackagedApp() {
  const distRoots = [resolve('packages/desktop/dist'), resolve('dist')];
  const candidates = distRoots.flatMap((desktopDist) => [
    join(desktopDist, 'mac-arm64', 'MindOS.app'),
    join(desktopDist, 'mac', 'MindOS.app'),
    join(desktopDist, 'linux-unpacked', 'MindOS'),
    join(desktopDist, 'linux-unpacked', 'mindos'),
    join(desktopDist, 'linux-unpacked', 'mindos-desktop'),
    join(desktopDist, 'win-unpacked', 'MindOS.exe'),
    join(desktopDist, 'win-arm64-unpacked', 'MindOS.exe'),
    ...findDistFiles(desktopDist, /\.AppImage$/),
  ]);
  return candidates.find((candidate) => existsSync(candidate));
}

function findDistFiles(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => pattern.test(entry))
    .map((entry) => join(dir, entry));
}

function isArchMismatch(app) {
  if (process.platform === 'darwin') {
    const wantsArm = app.includes('mac-arm64');
    const wantsX64 = app.includes('/mac/');
    if (wantsArm && process.arch !== 'arm64') return true;
    if (wantsX64 && process.arch !== 'x64') return true;
  }
  if (process.platform === 'win32') {
    const wantsArm = app.includes('arm64');
    if (wantsArm && process.arch !== 'arm64') return true;
  }
  return false;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--app') parsed.app = argv[++i];
    else if (arg === '--timeout') parsed.timeout = argv[++i];
    else if (arg === '--web-port') parsed.webPort = argv[++i];
    else if (arg === '--mcp-port') parsed.mcpPort = argv[++i];
    else if (arg === '--skip-if-arch-mismatch') parsed.skipIfArchMismatch = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
