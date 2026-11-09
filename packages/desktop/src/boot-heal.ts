/**
 * Boot-time silent healing of residual state from a previous installation.
 *
 * Extracted from main.ts (which was 2330 lines). Behaviour is unchanged except
 * that the two progress messages are now localized like everything else.
 */
import path from 'path';
import { execFile as execFileChild } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { ProcessManager } from './process-manager';
import { waitForPortRelease, isPortInUse } from './port-finder';
import { isNodeVersionAcceptable, MIN_NODE_VERSION } from './node-version';
import { analyzeMindOsLayout, resolveWebAppDir } from './mindos-runtime-layout';
import { getDefaultBundledMindOsDirectory } from './mindos-runtime-path';
import { desktopTelemetry } from './telemetry';
import { getAppConfigStore } from './app-config-store';
import { mt } from './i18n/main-strings';
import {
  CONFIG_DIR,
  DEFAULT_MCP_PORT,
  DEFAULT_WEB_PORT,
  DESKTOP_HOME,
  readMindOsConfigFileUncached,
} from './desktop-config';

const execFileAsync = promisify(execFileChild);

export const NODE_RUNTIME_REPAIR_MARKER = path.join(CONFIG_DIR, 'node-runtime-repair-required.json');

/** Fast-restart window: a clean exit this recent means nothing needs healing. */
const CLEAN_EXIT_SKIP_MS = 30_000;

export function markNodeRuntimeRepairRequired(reason: string, nodePath: string | null | undefined): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
      NODE_RUNTIME_REPAIR_MARKER,
      JSON.stringify({
        reason,
        nodePath: nodePath || null,
        createdAt: new Date().toISOString(),
      }, null, 2),
      'utf-8',
    );
    console.warn(`[MindOS:heal] Private Node.js runtime refresh requested (${reason})`);
  } catch (err) {
    console.warn('[MindOS:heal] Failed to write Node.js runtime repair marker:', (err as Error)?.message);
  }
}

export function clearNodeRuntimeRepairMarker(): void {
  try { unlinkSync(NODE_RUNTIME_REPAIR_MARKER); } catch { /* marker absent */ }
}

function privateNodeDir(): string {
  return path.join(DESKTOP_HOME, '.mindos', 'node');
}

/** Remove private Node.js if it cannot run or is below the runtime baseline. */
export async function validatePrivateNode(): Promise<'missing' | 'ok' | 'removed'> {
  const stop = desktopTelemetry.startTimer('desktop.boot.validate_node');
  const nodeBin = path.join(
    privateNodeDir(),
    process.platform === 'win32' ? 'node.exe' : 'bin/node',
  );
  const repairRequested = existsSync(NODE_RUNTIME_REPAIR_MARKER);
  if (!existsSync(nodeBin)) {
    if (repairRequested) clearNodeRuntimeRepairMarker();
    stop({ result: 'missing' });
    return 'missing';
  }

  if (repairRequested) {
    console.warn('[MindOS:heal] Refreshing private Node.js after previous native runtime crash');
    try { rmSync(privateNodeDir(), { recursive: true, force: true }); } catch { /* best effort */ }
    clearNodeRuntimeRepairMarker();
    stop({ result: 'removed', reason: 'native-crash-marker' });
    return 'removed';
  }

  try {
    const { stdout } = await execFileAsync(nodeBin, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const version = (stdout as string).trim();
    if (isNodeVersionAcceptable(version)) {
      stop({ result: 'ok' });
      return 'ok';
    }
    console.warn(`[MindOS:heal] Private Node.js ${version} is below v${MIN_NODE_VERSION} — removing`);
  } catch {
    console.warn('[MindOS:heal] Private Node.js failed version check — removing');
  }

  // Remove the entire private node directory — downloadNode() will replace it
  try { rmSync(privateNodeDir(), { recursive: true, force: true }); } catch { /* best effort */ }
  clearNodeRuntimeRepairMarker();
  stop({ result: 'removed' });
  return 'removed';
}

/** Remove .next if it exists but is corrupt (missing BUILD_ID and no standalone server, or partial standalone). */
export function validateBuildCache(appDir: string): 'missing' | 'ok' | 'removed' {
  const stop = desktopTelemetry.startTimer('desktop.boot.validate_cache');
  const nextDir = path.join(appDir, '.next');
  if (!existsSync(nextDir)) {
    stop({ result: 'missing' });
    return 'missing';
  }

  const hasBuildId = existsSync(path.join(nextDir, 'BUILD_ID'));
  const hasStandalone = existsSync(path.join(nextDir, 'standalone', 'server.js'));

  // Standalone mode requires .next/static/ for CSS/JS assets — without it the UI is broken
  if (hasStandalone) {
    if (!existsSync(path.join(nextDir, 'static'))) {
      console.warn('[MindOS:heal] Incomplete standalone build (missing .next/static/) — removing to trigger rebuild');
      try { rmSync(nextDir, { recursive: true, force: true }); } catch { /* best effort */ }
      stop({ result: 'removed' });
      return 'removed';
    }
    stop({ result: 'ok' });
    return 'ok';
  }

  if (hasBuildId) {
    stop({ result: 'ok' });
    return 'ok';
  }

  // .next exists but neither BUILD_ID nor standalone — corrupt / interrupted build
  console.warn('[MindOS:heal] Corrupt .next build cache detected — removing to trigger rebuild');
  try { rmSync(nextDir, { recursive: true, force: true }); } catch { /* best effort */ }
  stop({ result: 'removed' });
  return 'removed';
}

/**
 * Detect and clean up a conflicting CLI launchd service (com.mindos.app).
 *
 * When users delete MindOS.app from Finder without quitting first, the CLI's
 * launchd daemon keeps running and auto-restarting `mindos start`, occupying
 * all available ports. Desktop needs to stop it before starting its own services.
 */
export async function cleanupConflictingLaunchdService(): Promise<void> {
  if (process.platform !== 'darwin') return;

  try {
    const execOpts = { encoding: 'utf-8' as const, timeout: 3000 };

    // Check if com.mindos.app service is registered with launchd
    let serviceExists = false;
    try {
      const { stdout } = await execFileAsync('launchctl', ['list', 'com.mindos.app'], execOpts);
      serviceExists = stdout.includes('com.mindos.app');
    } catch {
      // launchctl list exits non-zero if service doesn't exist — that's fine
      return;
    }

    if (!serviceExists) return;

    console.warn('[MindOS] Detected conflicting launchd service com.mindos.app — stopping it');

    // Step 1: bootout the service so launchd stops restarting it
    try {
      const { stdout: uidOutput } = await execFileAsync('id', ['-u'], execOpts);
      const uid = uidOutput.trim();
      await execFileAsync('launchctl', ['bootout', `gui/${uid}/com.mindos.app`], { ...execOpts, timeout: 5000 });
      console.info('[MindOS] Stopped launchd service com.mindos.app');
    } catch (err) {
      // Try `launchctl remove` as fallback (works on some macOS versions)
      try {
        await execFileAsync('launchctl', ['remove', 'com.mindos.app'], { ...execOpts, timeout: 5000 });
        console.info('[MindOS] Removed launchd service com.mindos.app via fallback');
      } catch {
        console.warn('[MindOS] Could not stop launchd service:', err instanceof Error ? err.message : err);
      }
    }

    // Step 2: Remove the plist file to prevent re-registration on next login
    const plistPath = path.join(DESKTOP_HOME, 'Library', 'LaunchAgents', 'com.mindos.app.plist');
    if (existsSync(plistPath)) {
      try {
        unlinkSync(plistPath);
        console.info(`[MindOS] Removed ${plistPath}`);
      } catch (err) {
        console.warn('[MindOS] Could not remove plist:', err instanceof Error ? err.message : err);
      }
    }

    // Step 3: Kill residual CLI mindos processes still holding ports.
    // Use full path pattern to avoid killing our own Desktop process.
    const patterns = [
      'node_modules/@geminilight/mindos/bin/cli.js start',
      // Next.js workers spawned by the CLI. The old app/ pattern stays as a
      // cleanup-only fallback for users upgrading from pre-v1 packages.
      'node_modules/@geminilight/mindos/packages/web/node_modules/.bin/next',
      'node_modules/@geminilight/mindos/app/node_modules/.bin/next',
    ];
    for (const pattern of patterns) {
      try {
        await execFileAsync('pkill', ['-f', pattern], execOpts);
      } catch { /* no matching processes — fine */ }
    }

    // Note: no explicit wait needed — findAvailablePort will retry if ports haven't released yet
  } catch (err) {
    // Non-critical — if cleanup fails, findAvailablePort will still work as fallback
    console.warn('[MindOS] launchd cleanup failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Detect and clean up a conflicting CLI systemd user service on Linux.
 *
 * Similar to the macOS launchd case: if the user ran `mindos start --daemon`
 * (which creates ~/.config/systemd/user/mindos.service), then deleted the app,
 * systemd keeps restarting the service and occupies all ports.
 */
export async function cleanupLinuxSystemdService(): Promise<void> {
  if (process.platform !== 'linux') return;

  try {
    const opts = { encoding: 'utf-8' as const, timeout: 5000 };
    const isSystemdServiceActive = async (service: string) => {
      try {
        const { stdout } = await execFileAsync('systemctl', ['--user', 'is-active', service], opts);
        const state = stdout.trim();
        return state === 'active' || state === 'activating';
      } catch {
        return false;
      }
    };
    const stopSystemdService = async (service: string) => {
      try { await execFileAsync('systemctl', ['--user', 'stop', service], opts); } catch { /* ok */ }
      try { await execFileAsync('systemctl', ['--user', 'disable', service], opts); } catch { /* ok */ }
    };

    if (await isSystemdServiceActive('mindos')) {
      console.warn('[MindOS] Detected conflicting systemd service mindos — stopping it');
      await stopSystemdService('mindos');
      console.info('[MindOS] Stopped systemd user service');
      return;
    }

    // Also check by alternative service name com.mindos.app
    if (await isSystemdServiceActive('com.mindos.app')) {
      console.warn('[MindOS] Detected conflicting systemd service com.mindos.app — stopping it');
      await stopSystemdService('com.mindos.app');
    }
  } catch {
    // Non-critical
  }
}

export interface HealOptions {
  /** Report progress to the boot shell. */
  onProgress?: (message: string) => void;
}

/**
 * Detect and silently fix residual state from a previous MindOS installation.
 *
 * Safe to call on every boot (idempotent). Never touches user data (config
 * values, knowledge base, auth tokens).
 */
export async function healPreviousInstallation(opts: HealOptions = {}): Promise<void> {
  const t0 = Date.now();
  const stopHeal = desktopTelemetry.startTimer('desktop.boot.heal');
  const progress = opts.onProgress ?? (() => {});

  // Fast-restart optimisation: if the app exited cleanly less than 30 s ago,
  // skip the full cleanup — no orphaned processes or stale ports to worry about.
  try {
    const lastCleanExit = getAppConfigStore().get('lastCleanExit');
    if (lastCleanExit && (t0 - lastCleanExit) < CLEAN_EXIT_SKIP_MS) {
      const cleanExitAgoMs = t0 - lastCleanExit;
      console.info(`[MindOS:heal] Clean exit ${cleanExitAgoMs}ms ago — skipping cleanup`);
      stopHeal({ skipped: true, cleanExitAgoMs });
      return;
    }
  } catch { /* config read failure — run full heal */ }

  // 1. Stop launchd/systemd daemon — prevents it from respawning processes we just killed
  progress(mt('healCheckingPrevious'));
  await cleanupConflictingLaunchdService();
  await cleanupLinuxSystemdService();

  // 2. Kill orphaned processes from BOTH Desktop and CLI pid files
  await ProcessManager.cleanupOrphanedChildren();
  await ProcessManager.cleanupCliPidFile();

  // 3. Port-based fallback kill — catches processes not tracked by PID files
  //    (e.g. Next.js worker processes, externally started MCP)
  //    Brief pause gives SIGTERM'd processes time to exit before we check ports.
  await new Promise(r => setTimeout(r, 500));

  const config = readMindOsConfigFileUncached();
  const webPort = config.port || DEFAULT_WEB_PORT;
  const mcpPort = config.mcpPort || DEFAULT_MCP_PORT;

  // Port cleanup and runtime validation are independent — run them in parallel.
  // Port chain: check → kill → wait release (must be serial internally).
  // Validate chain: node → cache (fast, no port dependency).
  progress(mt('healFreeingPorts'));

  const portCleanup = async () => {
    const webInUse = await isPortInUse(webPort);
    const mcpInUse = await isPortInUse(mcpPort);

    if (webInUse) await ProcessManager.killProcessesOnPort(webPort);
    if (mcpInUse) await ProcessManager.killProcessesOnPort(mcpPort);

    // Wait for configured ports to free up (gives killed processes time to exit).
    // Prevents findAvailablePort from jumping to the next port during reinstall.
    if (webInUse || mcpInUse) {
      const [webFreed, mcpFreed] = await Promise.all([
        webInUse ? waitForPortRelease(webPort, 5000) : Promise.resolve(true),
        mcpInUse ? waitForPortRelease(mcpPort, 5000) : Promise.resolve(true),
      ]);
      if (!webFreed) {
        console.warn(`[MindOS:heal] Port ${webPort} still in use after cleanup — findAvailablePort will handle it`);
      }
      if (!mcpFreed) {
        console.warn(`[MindOS:heal] Port ${mcpPort} still in use after cleanup — findAvailablePort will handle it`);
      }
    }

    return { webInUse, mcpInUse };
  };

  const runtimeValidation = async () => {
    await validatePrivateNode();
    try {
      const bundledRoot = getDefaultBundledMindOsDirectory();
      if (bundledRoot) validateBuildCache(resolveWebAppDir(bundledRoot));
    } catch { /* non-critical */ }
  };

  const [portResult] = await Promise.all([portCleanup(), runtimeValidation()]);

  const elapsed = Date.now() - t0;
  stopHeal({ skipped: false, webInUse: portResult.webInUse, mcpInUse: portResult.mcpInUse });
  if (elapsed > 100) {
    console.info(`[MindOS:heal] Previous installation healing completed in ${elapsed}ms`);
  }
}

/** Bundled runtime version, used to prune stale cached Core downloads at boot. */
export function readBundledRuntimeVersion(): string | null {
  try {
    const bundledDir = getDefaultBundledMindOsDirectory();
    if (!bundledDir || !existsSync(bundledDir)) return null;
    return analyzeMindOsLayout(bundledDir).version;
  } catch {
    return null;
  }
}
