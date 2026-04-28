/**
 * mindos start — production app + MCP server
 */

import { execSync, execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  cpSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  ROOT,
  PACKAGE_ROOT,
  WEB_APP_DIR,
  CONFIG_PATH,
  LOG_PATH,
  CLI_PATH,
  STANDALONE_SERVER,
} from '../lib/constants.js';
import { dim, cyan, green, red, yellow } from '../lib/colors.js';
import { loadConfig, isDaemonMode } from '../lib/config.js';
import {
  ensureAppDeps,
  needsBuild,
  cleanNextDir,
  writeBuildStamp,
  hasPrebuiltStandalone,
} from '../lib/build.js';
import { assertPortFree } from '../lib/port.js';
import { savePids, clearPids } from '../lib/pid.js';
import { killByPort } from '../lib/stop.js';
import { printStartupInfo } from '../lib/startup.js';
import { spawnMcp } from '../lib/mcp-spawn.js';
import { EXIT } from '../lib/command.js';
import { execInherited } from '../lib/shell.js';

/** Local Next.js binary (avoids a mismatched global `next`). */
const NEXT_BIN = resolve(WEB_APP_DIR, 'node_modules', '.bin', 'next');

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

/** Command metadata for registry / help. */
export const meta = {
  name: 'start',
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
  const extra = args.join(' ');

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
          execSync(
            `osascript -e 'display notification "http://localhost:${webPort}" with title "MindOS Ready"'`,
            { stdio: 'ignore' },
          );
        } else if (process.platform === 'linux') {
          execSync(`notify-send "MindOS Ready" "http://localhost:${webPort}"`, { stdio: 'ignore' });
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
  if (startupCfg.setupPort && Number(startupCfg.setupPort) !== Number(webPort)) {
    killByPort(Number(startupCfg.setupPort));
  }

  // ── Auto-migrate user preferences → .mindos/user-preferences.md ────────
  try {
    const mr = startupCfg.mindRoot;
    if (mr && existsSync(mr)) {
      const mindosDir = resolve(mr, '.mindos');
      const newPath = resolve(mindosDir, 'user-preferences.md');

      if (!existsSync(newPath)) {
        // Ensure .mindos/ directory exists
        if (!existsSync(mindosDir)) mkdirSync(mindosDir, { recursive: true });

        // Try migrate from previous locations (newest → oldest)
        const prevPaths = [
          resolve(mindosDir, 'user-rules.md'), // v0.6.x interim
          resolve(mr, 'user-skill-rules.md'), // v0.5.x root
        ];
        let migrated = false;
        for (const prev of prevPaths) {
          if (existsSync(prev)) {
            cpSync(prev, newPath);
            unlinkSync(prev);
            console.log(
              `  ${green('✓')} ${dim(`Migrated ${prev.split('/').pop()} → .mindos/user-preferences.md`)}`,
            );
            migrated = true;
            break;
          }
        }
        if (!migrated) {
          // Try legacy location (.agents/skills/{name}/user-rules.md)
          const isZh = startupCfg.disabledSkills?.includes('mindos');
          const sName = isZh ? 'mindos-zh' : 'mindos';
          const oldPath = resolve(mr, '.agents', 'skills', sName, 'user-rules.md');
          if (existsSync(oldPath)) {
            cpSync(oldPath, newPath);
            console.log(
              `  ${green('✓')} ${dim('Migrated .agents/skills/ user-rules.md → .mindos/user-preferences.md')}`,
            );
          }
        }
      }
    }
  } catch { /* best-effort, don't block startup */ }

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
  process.env.MINDOS_NODE_BIN = process.execPath;
  ensureAppDeps();
  if (needsBuild()) {
    console.log(yellow('Building MindOS (first run or new version detected)...\n'));
    cleanNextDir();
    execInherited('node scripts/gen-renderer-index.js', ROOT);
    execInherited(`${NEXT_BIN} build --webpack`, WEB_APP_DIR, {
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

  // Prefer prebuilt standalone server (shipped with npm package) over next start.
  // Standalone includes its own traced node_modules — no packages/web/node_modules needed.
  if (hasPrebuiltStandalone()) {
    const standaloneNodePath = ensureStandaloneRuntimeLayout();
    try {
      execFileSync(process.execPath, [STANDALONE_SERVER], {
        cwd: resolve(PACKAGE_ROOT, '_standalone'),
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          HOSTNAME: process.env.MINDOS_WEB_HOST || '0.0.0.0',
          PORT: webPort,
          NODE_PATH: [standaloneNodePath, process.env.NODE_PATH].filter(Boolean).join(pathSep),
        },
      });
    } catch (err) {
      process.exit(err.status || 1);
    }
  } else {
    execInherited(`${NEXT_BIN} start -p ${webPort} ${extra}`, WEB_APP_DIR, {
      HOSTNAME: process.env.MINDOS_WEB_HOST || '0.0.0.0',
    });
  }
};
