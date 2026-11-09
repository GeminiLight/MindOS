/**
 * Local mode: resolve a runtime, start the services, recover from crashes.
 *
 * Extracted from main.ts. It reads and writes the shared ShellState rather
 * than closing over main's module bindings, and the two places it needs to
 * call back into the app shell (tray refresh, restart) are injected so the
 * two files do not import each other.
 */
import { dialog, shell } from 'electron';
import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFile as execFileChild, spawn as spawnChild, type ChildProcess } from 'child_process';
import { ProcessManager } from './process-manager';
import { findAvailablePort } from './port-finder';
import { getNodePath, getNpxPath, getNpmPath, getLocalBinPath, getEnrichedEnv } from './node-detect';
import { resolveExecTarget } from './exec-target';
import { downloadNode, getPrivateNodePath, installMindosWithPrivateNode } from './node-bootstrap';
import { buildWebCrashDiagnostic, type WebCrashDiagnostic } from './desktop-crash-diagnostics';
import { resolveLocalMindOsProjectRoot, type ResolveMindOsErr, type ResolveMindOsOk } from './mindos-runtime-resolve';
import { isNextBuildCurrent, BUILD_VERSION_FILE, resolveWebAppDir } from './mindos-runtime-layout';
import { hasRequiredStandaloneAppFiles } from './runtime-health-contract';
import { getEffectiveMindRootFromConfig } from './mindos-desktop-config';
import { verifyMindOsWebHealth, verifyMindOsWebListening } from './mindos-web-health';
import { getUiLang } from './i18n/lang';
import { mt } from './i18n/main-strings';
import { updateMcpClientConfigs } from './mcp-client-config';
import { markNodeRuntimeRepairRequired, readBundledRuntimeVersion, validatePrivateNode } from './boot-heal';
import { ensureObsidianSecretStorageBroker, stopObsidianSecretStorageBroker } from './obsidian-broker-lifecycle';
import { shellStatus } from './boot-shell';
import { shell as shellState, liveMainWindow } from './shell-state';
import {
  OVERLAY_IDS,
  crashRepairOverlayHtml,
  injectOverlay as injectOverlayInto,
  removeOverlay as removeOverlayFrom,
  runtimeUpdateOverlayHtml,
} from './overlays';
import {
  CONFIG_DIR,
  DEFAULT_MCP_PORT,
  DEFAULT_WEB_PORT,
  DESKTOP_HOME,
  PID_PATH,
  invalidateConfig,
  loadConfig,
  resolveLocalMindOsBrowseUrl,
} from './desktop-config';

/** Injected by main.ts so this module never imports the app shell back. */
export interface LocalModeHooks {
  refreshTray(status: 'starting' | 'running' | 'error'): void;
  restartServices(): Promise<void>;
  getDesktopInstallPath(): string;
}

let hooks: LocalModeHooks;
export function configureLocalMode(value: LocalModeHooks): void { hooks = value; }

const refreshTray = (status: 'starting' | 'running' | 'error') => hooks.refreshTray(status);
const injectOverlay = (id: string, html: string) => injectOverlayInto(liveMainWindow(), id, html);
const removeOverlay = (id: string) => removeOverlayFrom(liveMainWindow(), id);
const getDesktopInstallPath = () => hooks.getDesktopInstallPath();

// ── CLI Conflict Detection ──

export function checkCliConflict(): { running: boolean; webPort?: number; mcpPort?: number } {
  try {
    if (!existsSync(PID_PATH)) return { running: false };
    const pids = readFileSync(PID_PATH, 'utf-8').trim().split('\n').map(Number).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        const config = loadConfig();
        return { running: true, webPort: config.port || DEFAULT_WEB_PORT, mcpPort: config.mcpPort || DEFAULT_MCP_PORT };
      } catch { /* not running */ }
    }
    return { running: false };
  } catch {
    return { running: false };
  }
}

export async function openCrashLog(): Promise<void> {
  const logPath = path.join(CONFIG_DIR, 'crash.log');
  if (!existsSync(logPath)) {
    dialog.showErrorBox(mt('logNotFoundTitle'), logPath);
    return;
  }
  const result = await shell.openPath(logPath);
  if (result) {
    dialog.showErrorBox(mt('couldNotOpenLogTitle'), result);
  }
}

// ── Local Mode ──

async function applyPendingCoreUpdateForResolvedRuntime(
  runtimeRes: ResolveMindOsOk,
  nodePath: string,
): Promise<ResolveMindOsOk | ResolveMindOsErr> {
  // Explicit runtime overrides are user/developer controlled. Do not mutate the
  // cached runtime just because a Core download happens to be present.
  if (runtimeRes.pick.source === 'override') return runtimeRes;
  const runtimePolicy = loadConfig().mindosRuntimePolicy ?? process.env.MINDOS_RUNTIME_POLICY;
  if (runtimePolicy === 'bundled-only' || runtimePolicy === 'user-only') return runtimeRes;

  const currentVersion = runtimeRes.pick.version;
  const pending = shellState.coreUpdater.getPendingVersion(currentVersion);
  if (!pending) return runtimeRes;

  try {
    shellState.coreUpdater.apply(currentVersion);
    const appliedVersion = shellState.coreUpdater.getCachedVersion() ?? pending;
    console.info(
      `[MindOS] Auto-applied pending Core update v${appliedVersion} at boot (previous: ${currentVersion ?? 'unknown'})`,
    );
  } catch (e) {
    console.warn('[MindOS] Boot auto-apply of pending Core update skipped:', e);
    return runtimeRes;
  }

  return resolveLocalMindOsProjectRoot(loadConfig(), nodePath);
}

/** Splash actions offered when local boot fails. */
const LOCAL_BOOT_FAILURE_ACTIONS = [
  { id: 'retry', label: 'retry', primary: true },
  { id: 'switch-remote', label: 'switchRemote' },
  { id: 'quit', label: 'quit' },
] as const;

export async function startLocalMode(): Promise<string | null> {
  invalidateConfig(); // Always re-read config (may have changed via setup wizard or settings)
  const config = loadConfig();

  shellStatus({ status: 'detecting' });

  // 1. Node.js check — bundled > private ~/.mindos/node > system > auto-download
  let nodePath = await getNodePath();
  if (nodePath) {
    console.info(`[MindOS] Node.js: ${nodePath}`);
  }
  if (!nodePath) {
    shellStatus({ message: mt('downloadingNodeRuntime') });
    try {
      nodePath = await downloadNode((percent, status) => {
        if (status === 'downloading') {
          shellStatus({ message: mt('downloadingNodePercent', { percent }) });
        } else if (status === 'extracting') {
          shellStatus({ message: mt('installingNode') });
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      shellStatus({
        error: mt('nodeDownloadFailed', { message }),
        actions: LOCAL_BOOT_FAILURE_ACTIONS,
      });
      return null;
    }
  }

  // 2. MindOS root — bundled vs cached vs global vs override
  // Clean up stale cached runtimes before resolution
  try {
    shellState.coreUpdater.cleanupOnBoot(readBundledRuntimeVersion());
  } catch (e) { console.warn('[MindOS] cleanupOnBoot failed:', e); }

  let runtimeRes = await resolveLocalMindOsProjectRoot(loadConfig(), nodePath);
  if (runtimeRes.ok) {
    runtimeRes = await applyPendingCoreUpdateForResolvedRuntime(runtimeRes, nodePath);
  }
  if (!runtimeRes.ok) {
    shellStatus({
      error: getUiLang() === 'zh' ? runtimeRes.messageZh : runtimeRes.messageEn,
      actions: LOCAL_BOOT_FAILURE_ACTIONS,
    });
    return null;
  }

  const { pick: runtimePick } = runtimeRes;
  shellState.currentCoreVersion = runtimePick.version;
  console.info(
    `[MindOS] runtime pick source=${runtimePick.source} root=${runtimePick.projectRoot ?? '—'} version=${runtimePick.version ?? '—'}${runtimePick.reason ? ` reason=${runtimePick.reason}` : ''}`,
  );

  let projectRoot: string | null = runtimeRes.projectRoot;
  if (!projectRoot && runtimeRes.needsInstallFallback) {
    projectRoot = runtimeRes.userCandidatePath;
    if (!projectRoot) {
      shellStatus({ message: mt('installingMindos') });
      try {
        projectRoot = await installMindosWithPrivateNode(nodePath, (status) => {
          if (status === 'installing') {
            shellStatus({ message: mt('installingMindosFirstRun') });
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        shellStatus({
          error: mt('mindosInstallFailed', { message }),
          actions: LOCAL_BOOT_FAILURE_ACTIONS,
        });
        return null;
      }
    }
  }

  if (!projectRoot) {
    shellStatus({
      error: mt('noRunnableMindos'),
      actions: LOCAL_BOOT_FAILURE_ACTIONS,
    });
    return null;
  }

  const npxPath = getNpxPath(nodePath);

  // 3. CLI conflict check — mindos.pid can be stale; must not loadURL before /api/health works
  const conflict = checkCliConflict();
  if (conflict.running && conflict.webPort != null) {
    const healthy = await verifyMindOsWebListening(conflict.webPort);
    if (healthy) {
      shellStatus({ status: 'connecting' });
      shellState.currentWebPort = conflict.webPort;
      shellState.currentMcpPort = conflict.mcpPort;
      return `http://127.0.0.1:${conflict.webPort}`;
    }
    console.warn(
      '[MindOS] mindos.pid suggests a running CLI but /api/health did not succeed — starting a local server from the bundled runtime.',
    );
  }

  // 4. Ensure app is built (first run or after update — npm package has no .next)
  //    Check for valid build (BUILD_ID or standalone/server.js), not just .next dir existence.
  //    An incomplete .next (interrupted build, empty dir) would let Next.js crash at startup.
  //    OPTIMIZATION: Bundled/cached standalone runtimes ship pre-built — skip rebuild entirely
  //    when standalone/server.js and all required assets are present. This avoids the costly
  //    npm install + next build cycle (5-15 min on Windows) that was triggered by version
  //    stamp mismatches on upgrade-in-place scenarios.
  const appDir = resolveWebAppDir(projectRoot);
  const nextDir = path.join(appDir, '.next');
  const isPrebuiltStandalone =
    (runtimePick.source === 'bundled' || runtimePick.source === 'cached') &&
    hasRequiredStandaloneAppFiles(appDir);
  if (isPrebuiltStandalone) {
    console.info(`[MindOS] Skipping rebuild — ${runtimePick.source} standalone runtime is intact`);
  } else if (!isNextBuildCurrent(appDir, projectRoot)) {
    shellStatus({ message: mt('buildingFirstRun') });
    try {
      const enrichedEnv = getEnrichedEnv(nodePath);
      // Step 4a: Install app dependencies
      const npmBin = getNpmPath(path.dirname(nodePath));
      if (existsSync(npmBin) && existsSync(path.join(appDir, 'package.json'))) {
        shellStatus({ message: mt('installingDependencies') });
        await spawnWithEnv(npmBin, ['install'], appDir, enrichedEnv, 300000);
      }
      // Step 4b: Generate renderer index (needed before build)
      const genScript = path.join(projectRoot, 'scripts', 'gen-renderer-index.js');
      if (existsSync(genScript)) {
        await spawnWithEnv(nodePath, [genScript], projectRoot, enrichedEnv, 30000);
      }
      // Step 4c: Run next build
      shellStatus({ message: mt('compilingFrontend') });
      const nextBin = getLocalBinPath(appDir, 'next');
      const buildBin = existsSync(nextBin) ? nextBin : npxPath;
      const buildArgs = existsSync(nextBin) ? ['build'] : ['next', 'build'];
      await spawnWithEnv(buildBin, buildArgs, appDir, enrichedEnv, 600000);
      // Write build version stamp
      try {
        const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
        writeFileSync(path.join(nextDir, BUILD_VERSION_FILE), version, 'utf-8');
      } catch (stampErr) { console.warn('[MindOS] Failed to write build version stamp:', stampErr); }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      shellStatus({
        error: mt('buildFailed', { message }),
        actions: LOCAL_BOOT_FAILURE_ACTIONS,
      });
      return null;
    }
  } // closes the else-if for !isNextBuildCurrent

  shellStatus({ status: 'starting' });

  const findLocalModePorts = async (webStart: number, mcpStart: number) => {
    const resolvedWebPort = await findAvailablePort(webStart);
    let probe = mcpStart;
    for (let i = 0; i < 30; i++) {
      const resolvedMcpPort = await findAvailablePort(probe);
      if (resolvedMcpPort !== resolvedWebPort) {
        return { webPort: resolvedWebPort, mcpPort: resolvedMcpPort };
      }
      probe = resolvedMcpPort + 1;
    }
    throw new Error(`No distinct MCP port available near ${mcpStart}`);
  };

  // 5. Find distinct ports + spawn (retry once if a port was stolen between check and bind)
  let webPort: number;
  let mcpPort: number;
  try {
    ({ webPort, mcpPort } = await findLocalModePorts(config.port || DEFAULT_WEB_PORT, config.mcpPort || DEFAULT_MCP_PORT));
  } catch {
    // Port range exhausted — likely orphaned processes from a previous crash.
    // Kill them and retry instead of showing a dead-end error.
    await ProcessManager.cleanupOrphanedChildren();
    try {
      ({ webPort, mcpPort } = await findLocalModePorts(config.port || DEFAULT_WEB_PORT, config.mcpPort || DEFAULT_MCP_PORT));
    } catch {
      const basePort = config.port || DEFAULT_WEB_PORT;
      const portHint = process.platform === 'win32'
        ? `netstat -ano | findstr :${basePort}`
        : `lsof -nP -iTCP:${basePort} -sTCP:LISTEN`;
      shellStatus({
        error: mt('portsAllInUse', { from: basePort, to: basePort + 9, hint: portHint }),
        actions: [
          { id: 'retry', label: 'retry', primary: true },
          { id: 'quit', label: 'quit' },
        ],
      });
      return null;
    }
  }

  const secretStorageBroker = await ensureObsidianSecretStorageBroker();

  const createProcessManager = (wp: number, mp: number) => new ProcessManager({
    nodePath, npxPath, projectRoot, webPort: wp, mcpPort: mp,
    mindRoot:
      getEffectiveMindRootFromConfig(config) ||
      path.join(DESKTOP_HOME, 'MindOS', 'mind'),
    authToken: config.authToken,
    webPassword: typeof config.webPassword === 'string' ? config.webPassword : undefined,
    installDir: getDesktopInstallPath(),
    obsidianSecretStorageBroker: secretStorageBroker
      ? { url: secretStorageBroker.url, token: secretStorageBroker.token }
      : undefined,
    verbose: false,
    env: getEnrichedEnv(nodePath),
  });

  // Clean up any previous shellState.processManager (e.g. from retry or mode switch)
  if (shellState.processManager) {
    shellState.processManager.removeAllListeners();
    try { await shellState.processManager.stop(); } catch { /* best-effort cleanup */ }
  }

  shellState.processManager = createProcessManager(webPort, mcpPort);

  try {
    await shellState.processManager.start();
  } catch (startErr) {
    const msg = startErr instanceof Error ? startErr.message : '';
    // Port stolen between findAvailablePort and actual bind — retry once with fresh ports
    if (msg.includes('EADDRINUSE') || msg.includes('address already in use')) {
      console.warn('[MindOS] Port conflict detected, retrying with fresh ports...');
      try { await shellState.processManager.stop(); } catch { /* best-effort */ }
      ({ webPort, mcpPort } = await findLocalModePorts(webPort + 1, mcpPort + 1));
      shellState.processManager = createProcessManager(webPort, mcpPort);
      try {
        await shellState.processManager.start();
      } catch (retryErr) {
        await stopObsidianSecretStorageBroker();
        throw retryErr;
      }
    } else {
      await stopObsidianSecretStorageBroker();
      throw startErr;
    }
  }

  // Read effective ports (may have changed during EADDRINUSE retry or respawn)
  shellState.currentWebPort = shellState.processManager.webPort;
  shellState.currentMcpPort = shellState.processManager.mcpPort;
  webPort = shellState.currentWebPort;
  mcpPort = shellState.currentMcpPort;

  // Auto-update MCP client configs if ports shifted from configured values.
  // This happens when healing couldn't free the original port (non-MindOS process occupying it).
  const configuredMcpPort = config.mcpPort || DEFAULT_MCP_PORT;
  if (mcpPort !== configuredMcpPort) {
    console.info(`[MindOS] MCP port shifted ${configuredMcpPort} → ${mcpPort} — updating client configs`);
    updateMcpClientConfigs(configuredMcpPort, mcpPort);
  }

  let crashDialogShown = false;
  let startupComplete = false;  // Only show crash dialog after successful startup

  shellState.processManager.on('mcp-port-blocked', async (blockedPort: number) => {
    // Find a suggested alternative port
    let suggestedPort: number | null = null;
    try {
      suggestedPort = await findAvailablePort(blockedPort + 1);
    } catch { /* fallback to no suggestion */ }

    const title = mt('mcpPortBlockedTitle');
    const detail = suggestedPort
      ? mt('mcpPortBlockedWithSuggestion', { blockedPort, suggestedPort })
      : mt('mcpPortBlocked', { blockedPort });

    const buttons = suggestedPort
      ? [mt('useSuggestedPort', { port: suggestedPort }), mt('dismiss')]
      : [mt('ok')];

    if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) return;
    const result = await dialog.showMessageBox(shellState.mainWindow, {
      type: 'warning',
      title,
      message: title,
      detail,
      buttons,
      defaultId: 0,
    });

    if (suggestedPort && result.response === 0) {
      // User chose to use the suggested port — respawn MCP and update client configs
      try {
        shellState.processManager?.startMcpOnPort(suggestedPort);
        console.info(`[MindOS] MCP restarted on port ${suggestedPort}`);
        shellState.currentMcpPort = suggestedPort;
        refreshTray('running');
        // Auto-update MCP client configs that use http transport with the old port
        updateMcpClientConfigs(blockedPort, suggestedPort);
      } catch (err) {
        console.error('[MindOS] Failed to start MCP on suggested port:', err);
      }
    }
  });

  shellState.processManager.on('crash', (which: string, count: number, exitCode?: number | null, stderrLines?: string[]) => {
    if (which === 'mcp' && count >= 3) {
      refreshTray('running');
    }
    // During startup, crashes are handled by start()'s throw → splash error.
    // Only show crash dialog for post-startup failures.
    if (which === 'web' && count >= 3 && !crashDialogShown && startupComplete) {
      // Check if MindOS update is in progress — don't show crash dialog during update
      const updateStatusPath = path.join(CONFIG_DIR, 'update-status.json');
      let coreUpdateInProgress = false;
      try {
        if (existsSync(updateStatusPath)) {
          const status = JSON.parse(readFileSync(updateStatusPath, 'utf-8'));
          coreUpdateInProgress = status.stage && status.stage !== 'done' && status.stage !== 'failed';
        }
      } catch (err) {
        console.warn('[MindOS] Could not read update-status.json:', (err as Error)?.message);
      }

      if (coreUpdateInProgress) {
        // Update in progress — inject overlay and wait for new server
        void injectOverlay(OVERLAY_IDS.runtimeUpdate, runtimeUpdateOverlayHtml());
        refreshTray('starting');
        // Poll for server recovery
        shellState.activeRecoveryPoll = setInterval(async () => {
          try {
            const effectiveWebPort = shellState.processManager?.webPort ?? webPort;
            if (await verifyMindOsWebHealth(effectiveWebPort, 3000)) {
              clearInterval(shellState.activeRecoveryPoll!);
              shellState.activeRecoveryPoll = null;
              void removeOverlay(OVERLAY_IDS.runtimeUpdate);
              shellState.mainWindow?.loadURL(
                resolveLocalMindOsBrowseUrl(`http://127.0.0.1:${effectiveWebPort}`),
              );
              refreshTray('running');
            }
          } catch { /* still down */ }
        }, 3000);
        // Timeout after 5 minutes — clean up overlay and show error
        setTimeout(() => {
          if (shellState.activeRecoveryPoll) {
            clearInterval(shellState.activeRecoveryPoll);
            shellState.activeRecoveryPoll = null;
            void removeOverlay(OVERLAY_IDS.runtimeUpdate);
            refreshTray('error');
          }
        }, 300_000);
      } else {
        crashDialogShown = true;
        const diagnostic = buildWebCrashDiagnostic({
          zh: getUiLang() === 'zh',
          exitCode: exitCode ?? null,
          stderrLines,
          nodePath,
          privateNodePath: getPrivateNodePath(),
        });
        if (diagnostic.shouldRefreshPrivateNode) {
          markNodeRuntimeRepairRequired(diagnostic.cause, nodePath);
        }
        void showWebCrashRecoveryDialog(diagnostic, nodePath);
      }
    }
  });

  shellState.processManager.on('status-change', (status: string) => {
    refreshTray(status as 'starting' | 'running' | 'error');
    // Reset crash dialog flag when service recovers — so it can show again if it crashes later
    if (status === 'running') crashDialogShown = false;
  });

  startupComplete = true;
  shellStatus({ status: 'ready', done: true });
  return `http://127.0.0.1:${webPort}`;
}


export async function repairPrivateNodeRuntimeAndRestart(
  diagnostic: WebCrashDiagnostic,
  nodePath: string | null | undefined,
): Promise<void> {
  if (shellState.isCrashRepairing || shellState.isQuitting || shellState.isUpdating) return;
  shellState.isCrashRepairing = true;
  try {
    markNodeRuntimeRepairRequired(diagnostic.cause, nodePath);
    refreshTray('starting');
    await injectOverlay(OVERLAY_IDS.crashRepair, crashRepairOverlayHtml());

    if (shellState.processManager) {
      shellState.processManager.removeAllListeners();
      await shellState.processManager.stop().catch((err) => {
        console.warn('[MindOS:repair] ProcessManager stop failed:', err instanceof Error ? err.message : err);
      });
      shellState.processManager = null;
    }

    await validatePrivateNode();
    await downloadNode();

    const url = await startLocalMode();
    if (!url) {
      throw new Error(mt('repairStartedButNotRunning'));
    }

    if (shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
      await shellState.mainWindow.loadURL(resolveLocalMindOsBrowseUrl(url));
    }
    await removeOverlay(OVERLAY_IDS.crashRepair);
    refreshTray('running');
  } catch (err) {
    await removeOverlay(OVERLAY_IDS.crashRepair);
    refreshTray('error');
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(mt('repairFailedTitle'), msg);
  } finally {
    shellState.isCrashRepairing = false;
  }
}

export async function showWebCrashRecoveryDialog(
  diagnostic: WebCrashDiagnostic,
  nodePath: string | null | undefined,
): Promise<void> {
  const title = mt('serviceCrashedTitle');
  const buttons = diagnostic.actions.map((action) => action.label);
  const options = {
    type: 'error' as const,
    title,
    message: title,
    detail: diagnostic.message,
    buttons,
    defaultId: 0,
    cancelId: diagnostic.actions.findIndex((action) => action.id === 'dismiss'),
  };
  const result = shellState.mainWindow && !shellState.mainWindow.isDestroyed()
    ? await dialog.showMessageBox(shellState.mainWindow, options)
    : await dialog.showMessageBox(options);
  const action = diagnostic.actions[result.response]?.id ?? 'dismiss';

  if (action === 'repair-private-node') {
    await repairPrivateNodeRuntimeAndRestart(diagnostic, nodePath);
  } else if (action === 'restart-services') {
    await hooks.restartServices();
  } else if (action === 'open-log') {
    await openCrashLog();
  }
}

/** Spawn a process with enriched env, wait for exit. Rejects on non-zero or timeout. */
export function forceTerminateProcessTree(proc: ChildProcess): void {
  try {
    if (process.platform === 'win32' && proc.pid) {
      execFileChild('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], () => {});
      proc.kill();
      return;
    }
    if (proc.pid) {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* process may not own a group */ }
    }
    if (process.platform === 'win32') proc.kill();
    else proc.kill('SIGKILL');
  } catch { /* already exited */ }
}

function spawnWithEnv(bin: string, args: string[], cwd: string, env: Record<string, string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // On Windows, .cmd/.bat (npm.cmd, next.cmd) can't be spawned directly.
    // resolveExecTarget wraps them in cmd.exe with quoted argv — shell:true
    // would concatenate unquoted and break on paths with spaces.
    const target = resolveExecTarget(bin, args);
    const proc = spawnChild(target.command, target.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    shellState.activeBuildChild = proc;
    let settled = false;

    // Log last output for diagnostics on failure
    let lastOutput = '';
    proc.stdout?.on('data', (d: Buffer) => { lastOutput = d.toString().trim().split('\n').pop() || ''; });
    proc.stderr?.on('data', (d: Buffer) => { lastOutput = d.toString().trim().split('\n').pop() || ''; });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      forceTerminateProcessTree(proc);
      if (shellState.activeBuildChild === proc) shellState.activeBuildChild = null;
      reject(new Error(`${path.basename(bin)} ${args[0] || ''} timed out after ${Math.round(timeoutMs / 1000)}s\nLast output: ${lastOutput}`));
    }, timeoutMs);
    proc.on('exit', (code: number | null) => {
      clearTimeout(timer);
      if (shellState.activeBuildChild === proc) shellState.activeBuildChild = null;
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(bin)} ${args[0] || ''} exited with code ${code}\n${lastOutput}`));
    });
    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      if (shellState.activeBuildChild === proc) shellState.activeBuildChild = null;
      if (!settled) { settled = true; reject(err); }
    });
  });
}
