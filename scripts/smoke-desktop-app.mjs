#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const appPath = args.app ? resolve(args.app) : findPackagedApp();
const timeoutMs = Number(args.timeout ?? 60_000);
const webPort = Number(args.webPort ?? 3456);
const home = mkdtempSync(join(tmpdir(), 'mindos-desktop-smoke-home-'));
const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-desktop-smoke-mind-'));
const logPath = join(tmpdir(), `mindos-desktop-smoke-${Date.now()}.log`);
const artifactLogDir = resolve('packages/desktop/dist/smoke-logs');
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

// arm64 Macs can execute the x64 build under Rosetta — actually smoke it
// instead of skipping (a skip means the Intel build ships unverified).
let rosettaPrefix = null;
if (args.skipIfArchMismatch && isArchMismatch(appPath)) {
  if (canRunUnderRosetta(appPath)) {
    console.log(`[smoke-desktop-app] arch mismatch — running x64 app under Rosetta`);
    rosettaPrefix = ['arch', '-x86_64'];
  } else {
    console.log(`[smoke-desktop-app] SKIP arch mismatch for ${appPath}`);
    process.exit(0);
  }
}

writeFileSync(join(mindRoot, 'README.md'), '# MindOS smoke\n', 'utf-8');
writeFileSync(logPath, `[smoke-desktop-app] log started ${new Date().toISOString()}\n`, 'utf-8');
seedDesktopConfig();

const executable = resolveExecutable(appPath);
console.log(`[smoke-desktop-app] Launching ${executable}`);
console.log(`[smoke-desktop-app] Log: ${logPath}`);

let child = process.platform === 'win32' && args.windowsRuntimeOnly
  ? spawnWindowsRuntime(executable)
  : spawnDesktopApp(executable);

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
  const recovered = await maybeRunWindowsRuntimeFallback(error);
  if (!recovered) {
    scanFatalLog(false);
    console.error(`[smoke-desktop-app] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    dumpDiagnostics();
    process.exitCode = 1;
  }
} finally {
  persistSmokeLogArtifact();
  terminateChild();
  restoreSeededConfigs();
  rmSync(home, { recursive: true, force: true });
  rmSync(mindRoot, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}

async function maybeRunWindowsRuntimeFallback(originalError) {
  if (process.platform !== 'win32' || !args.windowsRuntimeFallback || args.windowsRuntimeOnly) return false;
  const fatalPattern = findFatalLogPattern();
  if (fatalPattern) return false;

  const message = originalError instanceof Error ? originalError.message : String(originalError);
  appendLog(`\n[smoke-desktop-app] Windows Electron smoke did not become healthy: ${message}\n`);
  appendLog('[smoke-desktop-app] Retrying with packaged runtime-only smoke.\n');
  console.warn(`[smoke-desktop-app] Windows Electron smoke did not become healthy: ${message}`);
  console.warn('[smoke-desktop-app] Retrying with packaged runtime-only smoke.');

  terminateChild();
  child = spawnWindowsRuntime(executable);
  child.stdout.on('data', (chunk) => appendLog(chunk));
  child.stderr.on('data', (chunk) => appendLog(chunk));
  child.on('exit', (code, signal) => {
    appendLog(`\n[smoke-desktop-app] runtime fallback child exited code=${code} signal=${signal}\n`);
  });

  try {
    await waitForApp(timeoutMs);
    scanFatalLog();
    console.log(`[smoke-desktop-app] OK ${appPath} (Windows runtime fallback)`);
    process.exitCode = 0;
    return true;
  } catch (fallbackError) {
    scanFatalLog(false);
    console.error(`[smoke-desktop-app] Windows runtime fallback FAILED: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
    console.error(`[smoke-desktop-app] Original Electron smoke failure: ${message}`);
    dumpDiagnostics();
    process.exitCode = 1;
    return true;
  }
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
  const text = chunk.toString();
  log += text;
  appendFileSync(logPath, text);
}

function spawnDesktopApp(executablePath) {
  const launchArgs = process.platform === 'linux' ? ['--no-sandbox'] : [];
  // Under Rosetta, `arch` becomes the process-group leader; group kill in
  // terminateChild still reaches the app since it shares the group.
  const [command, ...prefixArgs] = rosettaPrefix
    ? [...rosettaPrefix, executablePath]
    : [executablePath];
  return spawn(command, [...prefixArgs, ...launchArgs], {
    cwd: dirname(executablePath),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_ENABLE_STACK_DUMPING: '1',
      APPIMAGE_EXTRACT_AND_RUN: process.platform === 'linux' ? '1' : process.env.APPIMAGE_EXTRACT_AND_RUN,
      MIND_ROOT: mindRoot,
      MINDOS_DESKTOP_CI_LOG: logPath,
      MINDOS_DESKTOP_HOME_DIR: home,
      MINDOS_DISABLE_CLI_SHIM_PATH_APPEND: '1',
      MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER: '1',
      MINDOS_WEB_PORT: String(webPort),
      MINDOS_MCP_PORT: String(args.mcpPort ?? 8781),
      MINDOS_RUNTIME_POLICY: 'bundled-only',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function spawnWindowsRuntime(executablePath) {
  const runtimeRoot = join(dirname(executablePath), 'resources', 'mindos-runtime');
  const nodePath = join(runtimeRoot, 'node', 'node.exe');
  const appDir = join(runtimeRoot, 'packages', 'web');
  const serverPath = join(appDir, '.next', 'standalone', 'server.js');

  for (const requiredPath of [runtimeRoot, nodePath, appDir, serverPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Windows packaged runtime smoke missing required path: ${requiredPath}`);
    }
  }

  console.log(`[smoke-desktop-app] Windows runtime-only smoke from packaged resources: ${serverPath}`);
  return spawn(nodePath, [serverPath], {
    cwd: appDir,
    detached: false,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      MIND_ROOT: mindRoot,
      MINDOS_DESKTOP_HOME_DIR: home,
      MINDOS_DISABLE_CLI_SHIM_PATH_APPEND: '1',
      MINDOS_DISABLE_OBSIDIAN_SECRET_STORAGE_BROKER: '1',
      MINDOS_WEB_PORT: String(webPort),
      MINDOS_MCP_PORT: String(args.mcpPort ?? 8781),
      MINDOS_PROJECT_ROOT: runtimeRoot,
      MINDOS_CLI_PATH: join(runtimeRoot, 'packages', 'mindos', 'bin', 'cli.js'),
      MINDOS_MANAGED: '1',
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(webPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function seedDesktopConfig() {
  const config = JSON.stringify({
    desktopMode: 'local',
    mindRoot,
    setupPending: false,
    mindosRuntimePolicy: 'bundled-only',
    port: webPort,
    mcpPort: Number(args.mcpPort ?? 8781),
  }, null, 2);

  seedConfigPath(join(home, '.mindos', 'config.json'), config);
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

function dumpDiagnostics() {
  const paths = [
    logPath,
    join(home, '.mindos', 'crash.log'),
  ];

  console.error(`[smoke-desktop-app] Home: ${home}`);
  console.error(`[smoke-desktop-app] Mind root: ${mindRoot}`);
  console.error(`[smoke-desktop-app] Seeded configs: ${seededConfigs.map((entry) => entry.configPath).join(', ')}`);

  for (const diagnosticPath of [...new Set(paths)]) {
    if (!existsSync(diagnosticPath)) {
      console.error(`[smoke-desktop-app] Missing diagnostic file: ${diagnosticPath}`);
      continue;
    }
    console.error(`[smoke-desktop-app] --- tail ${diagnosticPath} ---`);
    console.error(tailFile(diagnosticPath, 180));
  }
}

function persistSmokeLogArtifact() {
  try {
    if (!existsSync(logPath)) return;
    mkdirSync(artifactLogDir, { recursive: true });
    writeFileSync(join(artifactLogDir, basename(logPath)), readFileSync(logPath, 'utf-8'), 'utf-8');
  } catch {
    // Best effort only; the console dump above is the primary diagnostic surface.
  }
}

function tailFile(filePath, maxLines) {
  try {
    return readFileSync(filePath, 'utf-8').split('\n').slice(-maxLines).join('\n');
  } catch (error) {
    return `[unreadable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function scanFatalLog(throwOnMatch = true) {
  const pattern = findFatalLogPattern();
  if (!pattern) return;
  if (throwOnMatch) throw new Error(`fatal log pattern matched: ${pattern}`);
  process.exitCode = 1;
}

function findFatalLogPattern() {
  for (const pattern of fatalPatterns) {
    if (pattern.test(log)) {
      return pattern;
    }
  }
  return null;
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

/** Only the darwin x64-on-arm64 mismatch is runnable — probe that Rosetta is installed. */
function canRunUnderRosetta(app) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return false;
  if (!app.includes('/mac/')) return false;
  const probe = spawnSync('arch', ['-x86_64', '/usr/bin/true']);
  if (probe.status !== 0) {
    console.warn('[smoke-desktop-app] Rosetta unavailable — falling back to skip');
    return false;
  }
  return true;
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
    else if (arg === '--windows-runtime-only') parsed.windowsRuntimeOnly = true;
    else if (arg === '--windows-runtime-fallback') parsed.windowsRuntimeFallback = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
