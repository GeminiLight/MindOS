/**
 * mindos start — production app + MCP server
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  cpSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import {
  ROOT,
  PACKAGE_ROOT,
  WEB_APP_DIR,
  CONFIG_PATH,
  LOG_PATH,
  CLI_PATH,
  STATIC_WEB_ROOT,
  STANDALONE_SERVER,
} from '../lib/constants.js';
import { dim, cyan, green, red, yellow } from '../lib/colors.js';
import { loadConfig, isDaemonMode } from '../lib/config.js';
import { resolveInsideRoot } from '../lib/safe-path.js';
import {
  ensureAppDeps,
  needsBuild,
  cleanNextDir,
  writeBuildStamp,
  hasPrebuiltStandalone,
  hasPrebuiltStaticWeb,
  hasDocumentExtractionRuntime,
} from '../lib/build.js';
import { assertPortFree } from '../lib/port.js';
import { savePids, clearPids } from '../lib/pid.js';
import { killByPort } from '../lib/stop.js';
import { printStartupInfo } from '../lib/startup.js';
import { spawnMcp } from '../lib/mcp-spawn.js';
import { EXIT } from '../lib/command.js';
import { execInheritedFile } from '../lib/shell.js';

/** Local Next.js binary (avoids a mismatched global `next`). */
const NEXT_CLI = resolve(WEB_APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');

function ensureStandaloneRuntimeDir(liveName, publishableName) {
  const standaloneDir = resolve(PACKAGE_ROOT, '_standalone');
  const liveDir = resolve(standaloneDir, liveName);
  const publishableDir = resolve(standaloneDir, publishableName);

  if (!existsSync(publishableDir)) return null;
  if (existsSync(liveDir)) return publishableDir;

  try {
    symlinkSync(
      publishableName,
      liveDir,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch {
    cpSync(publishableDir, liveDir, {
      recursive: true,
      dereference: true,
    });
  }

  return publishableDir;
}

function ensureStandaloneRuntimeLayout() {
  ensureStandaloneRuntimeDir('.next', '__next');
  return ensureStandaloneRuntimeDir('node_modules', '__node_modules');
}

function runtimeJsExecutor() {
  return process.env.MINDOS_BINARY_EXECUTOR || process.execPath;
}

function hasWebSources() {
  return existsSync(resolve(WEB_APP_DIR, 'package.json'));
}

let warnedDegradedExtraction = false;

function useProductServer() {
  if (process.env.MINDOS_NEXT_STANDALONE === '1' && hasPrebuiltStandalone()) return false;
  if (process.env.MINDOS_PRODUCT_SERVER === '1') return true;
  if (!hasPrebuiltStaticWeb()) return false;
  if (hasDocumentExtractionRuntime()) return true;
  // A packaged runtime ships no packages/web sources, so the source-build
  // path can only crash (gen-renderer-index.js ENOENT, shipped in 1.1.7).
  // Serve the product server with degraded PDF/DOCX extraction instead.
  if (!hasWebSources()) {
    if (!warnedDegradedExtraction) {
      warnedDegradedExtraction = true;
      console.warn(yellow('Document extraction runtime missing from this package; PDF/DOCX import is degraded.'));
    }
    return true;
  }
  return false;
}

export function resolveWebHost(config = {}, env = process.env) {
  if (typeof env.MINDOS_WEB_HOST === 'string' && env.MINDOS_WEB_HOST.trim()) {
    return env.MINDOS_WEB_HOST;
  }
  return config.allowNetworkAccess === true ? '0.0.0.0' : '127.0.0.1';
}

export function migrateUserPreferences(startupCfg = {}, options = {}) {
  const log = options.log ?? console.log;
  const mr = startupCfg.mindRoot;
  if (!mr || !existsSync(mr)) return { migrated: false, reason: 'missing-root' };

  let newPath;
  try {
    newPath = resolveInsideRoot(mr, '.mindos/user-preferences.md');
  } catch {
    return { migrated: false, reason: 'unsafe-path' };
  }

  if (existsSync(newPath)) return { migrated: false, reason: 'exists' };

  try {
    const mindosDir = dirname(newPath);
    if (!existsSync(mindosDir)) mkdirSync(mindosDir, { recursive: true });

    const prevPaths = [
      { rel: '.mindos/user-rules.md', removeSource: true },
      { rel: 'user-skill-rules.md', removeSource: true },
    ];

    for (const candidate of prevPaths) {
      let prev;
      try {
        prev = resolveInsideRoot(mr, candidate.rel);
      } catch {
        continue;
      }
      if (!existsSync(prev)) continue;
      cpSync(prev, newPath);
      if (candidate.removeSource) unlinkSync(prev);
      log(
        `  ${green('✓')} ${dim(`Migrated ${basename(prev)} → .mindos/user-preferences.md`)}`,
      );
      return { migrated: true, source: candidate.rel };
    }

    const isZh = startupCfg.disabledSkills?.includes('mindos');
    const sName = isZh ? 'mindos-zh' : 'mindos';
    const legacyRel = `.agents/skills/${sName}/user-rules.md`;
    let oldPath;
    try {
      oldPath = resolveInsideRoot(mr, legacyRel);
    } catch {
      return { migrated: false, reason: 'not-found' };
    }
    if (existsSync(oldPath)) {
      cpSync(oldPath, newPath);
      log(
        `  ${green('✓')} ${dim('Migrated .agents/skills/ user-rules.md → .mindos/user-preferences.md')}`,
      );
      return { migrated: true, source: legacyRel };
    }

    return { migrated: false, reason: 'not-found' };
  } catch {
    return { migrated: false, reason: 'error' };
  }
}

/** Command metadata for registry / help. */
export const meta = {
  name: 'start',
  aliases: ['serve'],
  group: 'Service',
  summary: 'Start MindOS services',
  usage: 'mindos start',
  flags: {
    '--daemon': 'Run as background daemon',
    '--verbose': 'Show detailed output',
    '--port <port>': 'Override web port',
  },
  examples: [
    'mindos start',
    'mindos start --daemon',
    'mindos start --verbose',
  ],
};

/**
 * Start MindOS in production (foreground or OS service when `--daemon` / config daemon mode).
 *
 * @param {string[]} args — forwarded to `next start` after `-p <port>`
 * @param {Record<string, unknown>} flags — e.g. `daemon`, `verbose`
 * @returns {Promise<void>}
 */
export const run = async (args, flags) => {
  // Must be checked BEFORE isDaemon — when a daemon manager has already launched
  // us, re-entering the daemon installation path causes a recursive loop.
  const launchedByDaemon =
    process.env.LAUNCHED_BY_LAUNCHD === '1' || !!process.env.INVOCATION_ID;
  const isDaemon = !launchedByDaemon && (Boolean(flags.daemon) || isDaemonMode());
  const isVerbose = Boolean(flags.verbose);

  // Ensure `mindos` CLI shim + PATH injection (silent, best-effort)
  const isDesktop = !!(process.env.ELECTRON_RUN_AS_NODE || process.env.MINDOS_DESKTOP);
  if (!isDesktop) {
    try {
      const { ensureCliShim } = await import('../lib/cli-shim.js');
      ensureCliShim();
    } catch { /* best effort */ }
  }

  // Inject ~/.mindos/bin into current process PATH so child processes
  // (Next.js server, MCP) can find the `mindos` command.
  const { homedir } = await import('node:os');
  const mindosBinDir = resolve(homedir(), '.mindos', 'bin');
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const pathDirs = (process.env.PATH || '').split(pathSep);
  if (!pathDirs.includes(mindosBinDir)) {
    process.env.PATH = `${mindosBinDir}${pathSep}${process.env.PATH || ''}`;
  }

  // Check for incomplete setup
  if (existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (cfg.setupPending === true) {
        console.log(
          `\n  ${yellow('⚠ Setup was not completed.')} Run ${cyan('mindos onboard')} to finish, or ${cyan('mindos config set setupPending false')} to dismiss.\n`,
        );
      }
    } catch { /* ignore malformed config */ }
  }

  if (isDaemon) {
    const { getPlatform, runGatewayCommand, waitForHttp } = await import('../lib/gateway.js');
    const platform = getPlatform();
    if (!platform) {
      console.warn(
        yellow('Warning: daemon mode not supported on this platform. Falling back to foreground.'),
      );
    } else {
      loadConfig();
      if (!process.env.MINDOS_WEB_PORT) process.env.MINDOS_WEB_PORT = '3456';
      if (!process.env.MINDOS_MCP_PORT) process.env.MINDOS_MCP_PORT = '8781';
      const webPort = process.env.MINDOS_WEB_PORT;
      const mcpPort = process.env.MINDOS_MCP_PORT;
      console.log(cyan(`Installing MindOS as a background service (${platform})...`));
      await runGatewayCommand('install');
      // install() already starts the service via launchctl bootstrap + RunAtLoad=true.
      // Do NOT call start() here — kickstart -k would kill the just-started process,
      // causing a port-conflict race condition with KeepAlive restart loops.
      console.log(
        dim('  (First run may take a few minutes to install dependencies and build the app.)'),
      );
      const ready = await waitForHttp(Number(webPort), {
        retries: 180,
        intervalMs: 2000,
        label: 'Web UI',
        logFile: LOG_PATH,
      });
      if (!ready) {
        console.error(red('\n✘ Service started but Web UI did not become ready in time.'));
        console.error(dim('  Check logs with: mindos logs\n'));
        process.exit(EXIT.ERROR);
      }
      await printStartupInfo(webPort, mcpPort);
      // System notification
      try {
        if (process.platform === 'darwin') {
          execFileSync('osascript', [
            '-e',
            `display notification "http://localhost:${webPort}" with title "MindOS Ready"`,
          ], { stdio: 'ignore' });
        } else if (process.platform === 'linux') {
          execFileSync('notify-send', ['MindOS Ready', `http://localhost:${webPort}`], { stdio: 'ignore' });
        }
      } catch { /* notification is best-effort */ }
      console.log(`${green('✔ MindOS is running as a background service')}`);
      console.log(dim('  View logs:    mindos logs'));
      console.log(dim('  Stop:         mindos gateway stop'));
      console.log(dim('  Uninstall:    mindos gateway uninstall\n'));
      return;
    }
  }

  loadConfig();
  if (!process.env.MINDOS_WEB_PORT) process.env.MINDOS_WEB_PORT = '3456';
  if (!process.env.MINDOS_MCP_PORT) process.env.MINDOS_MCP_PORT = '8781';
  const webPort = process.env.MINDOS_WEB_PORT;
  const mcpPort = process.env.MINDOS_MCP_PORT;

  // Clean up zombie processes from an abandoned GUI setup session.
  // setup.js records a temporary port (setupPort) in config; if the user
  // closed the browser without completing setup, that process is still
  // running.  Kill it before we proceed.
  // Also read config for auto-migration below (avoids double readFileSync).
  let startupCfg = {};
  try {
    startupCfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch { /* ignore */ }
  const webHost = resolveWebHost(startupCfg);
  if (startupCfg.setupPort && Number(startupCfg.setupPort) !== Number(webPort)) {
    killByPort(Number(startupCfg.setupPort));
  }

  // ── Auto-migrate user preferences → .mindos/user-preferences.md ────────
  migrateUserPreferences(startupCfg);

  // When launched by a daemon manager (launchd/systemd), wait for ports to
  // free instead of exiting immediately — the previous instance may still be
  // shutting down after a restart/update.
  if (launchedByDaemon) {
    const { waitForPortFree } = await import('../lib/gateway.js');
    const webOk = await waitForPortFree(Number(webPort), { retries: 60, intervalMs: 500 });
    const mcpOk = await waitForPortFree(Number(mcpPort), { retries: 60, intervalMs: 500 });
    if (!webOk || !mcpOk) {
      console.error('Ports still in use after 30s, exiting.');
      process.exit(EXIT.ERROR); // KeepAlive will retry after ThrottleInterval
    }
  } else {
    await assertPortFree(Number(webPort), 'web');
    await assertPortFree(Number(mcpPort), 'mcp');
  }

  process.env.MINDOS_CLI_PATH = CLI_PATH;
  process.env.MINDOS_NODE_BIN = runtimeJsExecutor();
  if (!useProductServer()) {
    ensureAppDeps();
  }
  if (!useProductServer() && needsBuild()) {
    console.log(yellow('Building MindOS (first run or new version detected)...\n'));
    cleanNextDir();
    execInheritedFile(process.execPath, [resolve(ROOT, 'scripts/gen-renderer-index.js')], ROOT);
    execInheritedFile(process.execPath, [NEXT_CLI, 'build', '--webpack'], WEB_APP_DIR, {
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '),
    });
    writeBuildStamp();
  }

  const { stopSyncDaemon, startSyncDaemon } = await import('../lib/sync.js');

  const mcp = spawnMcp(isVerbose);
  savePids(process.pid, mcp.pid);
  process.on('exit', () => {
    try { stopSyncDaemon(); } catch {}
    clearPids();
  });

  const mindRoot = process.env.MIND_ROOT;
  if (mindRoot) {
    startSyncDaemon(mindRoot).catch(() => {});
  }

  await printStartupInfo(webPort, mcpPort);

  if (useProductServer()) {
    const { createMindosHttpServer } = await import('../../dist/server.js');
    const productServer = createMindosHttpServer({
      hostname: webHost,
      port: Number(webPort),
      runtimeRoot: PACKAGE_ROOT,
      staticRoot: STATIC_WEB_ROOT,
      syncDaemon: {
        start: (root) => { void startSyncDaemon(root).catch(() => {}); },
        stop: () => { try { stopSyncDaemon(); } catch {} },
        reconfigure: (root) => { void startSyncDaemon(root).catch(() => {}); },
        restart: (root) => {
          try { stopSyncDaemon(); } catch {}
          void startSyncDaemon(root).catch(() => {});
        },
      },
    });
    await productServer.listen();
    console.log(`${green('✔ Product Server')} ${dim(productServer.url)}`);
    await new Promise(() => {});
    return;
  }

  // Prefer prebuilt standalone server (shipped with npm package) over next start.
  // Standalone includes its own traced node_modules — no packages/web/node_modules needed.
  if (hasPrebuiltStandalone()) {
    const standaloneNodePath = ensureStandaloneRuntimeLayout();
    try {
      execFileSync(runtimeJsExecutor(), [STANDALONE_SERVER], {
        cwd: resolve(PACKAGE_ROOT, '_standalone'),
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          HOSTNAME: webHost,
          PORT: webPort,
          NODE_PATH: [standaloneNodePath, process.env.NODE_PATH].filter(Boolean).join(pathSep),
        },
      });
    } catch (err) {
      process.exit(err.status || 1);
    }
  } else {
    execInheritedFile(process.execPath, [NEXT_CLI, 'start', '-p', webPort, ...args], WEB_APP_DIR, {
      HOSTNAME: webHost,
    });
  }
};
