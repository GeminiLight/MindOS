/**
 * MindOS Desktop — Electron Main Process
 *
 * Startup flow:
 * 1. Show splash screen immediately (brand + progress)
 * 2. Detect environment + resolve URL (splash shows status)
 * 3. Create main window + loadURL → hide splash
 *
 * Mode switching flow:
 * 1. Inject overlay on main window (keep old content visible)
 * 2. Start new mode in background
 * 3. Success → loadURL new mode; Failure → remove overlay, keep old mode
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { spawn as spawnChild } from 'child_process';
import { ProcessManager } from './process-manager';
import { findAvailablePort } from './port-finder';
import { createTray, updateTrayMenu, type TrayCallbacks } from './tray';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { restoreWindowState, saveWindowState } from './window-state';
import { setupUpdater } from './updater';
import { ConnectionMonitor } from './connection-monitor';
import { showConnectWindow, showModeSelectWindow, getActiveRemoteConnection, loadPassword, clearActiveTunnel } from './connect-window';
import { cleanupOrphanedSshTunnel } from './ssh-tunnel';
import { testConnection } from '../../shared/connection';
import { getNodePath, getMindosInstallPath, getNpxPath, getEnrichedEnv } from './node-detect';
import { downloadNode, installMindosWithPrivateNode } from './node-bootstrap';
import { resolveLocalMindOsProjectRoot } from './mindos-runtime-resolve';
import { isNextBuildValid, isNextBuildCurrent, BUILD_VERSION_FILE } from './mindos-runtime-layout';
import {
  getEffectiveMindRootFromConfig,
  localBrowseNeedsSetupWizard,
  shouldSeedWebSetupPendingForLocal,
} from './mindos-desktop-config';
import { ensureMindosCliShim, refreshMindosCliAndNotify } from './install-cli-shim';
import { verifyMindOsWebListening } from './mindos-web-health';
import { resolvePreferUnpacked } from './resolve-packaged-asset';
import { registerMindosConnectSchemePrivileged, registerMindosConnectProtocol } from './mindos-connect-protocol';

registerMindosConnectSchemePrivileged();

// ── Constants ──
const CONFIG_DIR = path.join(app.getPath('home'), '.mindos');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const PID_PATH = path.join(CONFIG_DIR, 'mindos.pid');
const DEFAULT_WEB_PORT = 3456;
const DEFAULT_MCP_PORT = 8781;

// ── Paths (prefer app.asar.unpacked on macOS — see electron-builder asarUnpack) ──
const SPLASH_HTML = resolvePreferUnpacked('src', 'splash.html');
const SPLASH_PRELOAD = resolvePreferUnpacked('dist-electron', 'preload', 'splash-preload.js');
const MAIN_PRELOAD = resolvePreferUnpacked('dist-electron', 'preload', 'index.js');

// ── State ──
let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let connectionMonitor: ConnectionMonitor | null = null;
let isQuitting = false;
let activeRecoveryPoll: ReturnType<typeof setInterval> | null = null;
let currentMode: 'local' | 'remote' = 'local';
let currentWebPort: number | undefined;
let currentMcpPort: number | undefined;
let currentRemoteAddress: string | undefined;
let cachedConfig: MindOSConfig | null = null;

// ── Config ──
interface MindOSConfig {
  ai?: Record<string, unknown>;
  mindRoot?: string;
  /** Legacy key; Next readSettings maps sopRoot → mindRoot — Desktop must match */
  sopRoot?: string;
  port?: number;
  mcpPort?: number;
  authToken?: string;
  webPassword?: string;
  desktopMode?: 'local' | 'remote';
  /** @see wiki/specs/spec-desktop-bundled-mindos.md */
  mindosRuntimePolicy?: 'prefer-newer' | 'bundled-only' | 'user-only';
  mindosRuntimeRoot?: string;
  mindosRuntimeStrictCompat?: boolean;
  minMindOsVersion?: string;
  maxTestedMindOsVersion?: string;
  /** Shared with Next `readSettings` — true until setup wizard completes */
  setupPending?: boolean;
  [key: string]: unknown;
}

/** Read config.json from disk without touching `cachedConfig` (for merge / URL resolution). */
function readMindOsConfigFileUncached(): MindOSConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, 'utf-8').trim();
    if (!raw) return {};
    return JSON.parse(raw) as MindOSConfig;
  } catch (err) {
    console.warn('[MindOS] config.json is corrupt or unreadable, using defaults:', err instanceof Error ? err.message : err);
    return {};
  }
}

function loadConfig(): MindOSConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = readMindOsConfigFileUncached();
  ensureAuthToken(cachedConfig);
  return cachedConfig;
}

/** Auto-generate authToken if missing — prevents unauthenticated MCP exposure on 0.0.0.0 */
function ensureAuthToken(config: MindOSConfig): void {
  if (config.authToken) return;
  const token = randomBytes(24).toString('hex').slice(0, 24);
  config.authToken = token;
  try {
    mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    console.info('[MindOS] Auto-generated authToken (no onboard config found)');
  } catch (err) {
    console.warn('[MindOS] Failed to save auto-generated authToken:', err instanceof Error ? err.message : err);
  }
}

function invalidateConfig(): void { cachedConfig = null; }

/** Show mode picker when file missing, empty, invalid JSON, or desktopMode unset. */
function needsDesktopModeSelectAtLaunch(): boolean {
  if (!existsSync(CONFIG_PATH)) return true;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8').trim();
    if (!raw) return true;
    const j = JSON.parse(raw) as MindOSConfig;
    if (j.desktopMode !== 'local' && j.desktopMode !== 'remote') return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * When local server is up, open setup wizard if web onboarding is not done.
 * Uses same signals as Next `readSettings` (setupPending, mindRoot ?? sopRoot).
 */
function resolveLocalMindOsBrowseUrl(baseUrl: string): string {
  const u = baseUrl.replace(/\/$/, '');
  const j = readMindOsConfigFileUncached();
  if (localBrowseNeedsSetupWizard(j)) {
    return `${u}/setup?force=1`;
  }
  return u;
}

function saveDesktopMode(mode: 'local' | 'remote', opts?: { allowSeedWebSetup?: boolean }): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  invalidateConfig();
  const existing = readMindOsConfigFileUncached();
  const merged: MindOSConfig = { ...existing, desktopMode: mode };
  if (opts?.allowSeedWebSetup && shouldSeedWebSetupPendingForLocal(mode, existing)) {
    merged.setupPending = true;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  cachedConfig = merged;
}

// ── Splash Screen ──

function createSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 240,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    transparent: process.platform === 'darwin',
    titleBarStyle: 'hidden',
    alwaysOnTop: true,
    webPreferences: {
      preload: SPLASH_PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
  });

  win.loadFile(SPLASH_HTML).catch(() => {});
  win.once('ready-to-show', () => win.show());

  // If user closes splash, quit the app
  win.on('closed', () => {
    splashWindow = null;
    if (!mainWindow) app.quit();
  });

  return win;
}

function splashStatus(data: Record<string, unknown>): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:status', data);
  }
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ── Main Window ──

function createMainWindow(): BrowserWindow {
  const savedState = restoreWindowState();
  const win = new BrowserWindow({
    width: savedState?.width ?? 1200,
    height: savedState?.height ?? 800,
    x: savedState?.x, y: savedState?.y,
    minWidth: 800, minHeight: 600,
    title: 'MindOS',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 10 } : undefined,
    /** Match app light `globals.css` --background (#f8f6f1); reduces white flash before first paint. */
    backgroundColor: '#f8f6f1',
    webPreferences: {
      preload: MAIN_PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  if (savedState?.maximized) win.maximize();

  // macOS: hide window instead of closing
  win.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('resize', () => saveWindowState(win));
  win.on('move', () => saveWindowState(win));

  return win;
}

// ── CLI Conflict Detection ──

function checkCliConflict(): { running: boolean; webPort?: number; mcpPort?: number } {
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

// ── Local Mode ──

async function startLocalMode(): Promise<string | null> {
  const config = loadConfig();
  const zh = navigator_lang() === 'zh';

  splashStatus({ status: 'detecting' });

  // 1. Node.js check — bundled > private ~/.mindos/node > system > auto-download
  let nodePath = await getNodePath();
  if (nodePath) {
    console.info(`[MindOS] Node.js: ${nodePath}`);
  }
  if (!nodePath) {
    splashStatus({ message: zh ? '正在下载 Node.js 运行环境...' : 'Downloading Node.js runtime...' });
    try {
      nodePath = await downloadNode((percent, status) => {
        if (status === 'downloading') {
          splashStatus({ message: zh ? `正在下载 Node.js... ${percent}%` : `Downloading Node.js... ${percent}%` });
        } else if (status === 'extracting') {
          splashStatus({ message: zh ? '正在安装 Node.js...' : 'Installing Node.js...' });
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      splashStatus({
        error: zh ? `Node.js 下载失败: ${msg}` : `Node.js download failed: ${msg}`,
        actions: [
          { id: 'retry', label: 'retry', primary: true },
          { id: 'switch-remote', label: 'switchRemote' },
          { id: 'quit', label: 'quit' },
        ],
      });
      return null;
    }
  }

  // 2. MindOS root — bundled vs global vs override (spec-desktop-bundled-mindos)
  const runtimeRes = await resolveLocalMindOsProjectRoot(loadConfig(), nodePath);
  if (!runtimeRes.ok) {
    splashStatus({
      error: zh ? runtimeRes.messageZh : runtimeRes.messageEn,
      actions: [
        { id: 'retry', label: 'retry', primary: true },
        { id: 'switch-remote', label: 'switchRemote' },
        { id: 'quit', label: 'quit' },
      ],
    });
    return null;
  }

  const { pick: runtimePick } = runtimeRes;
  console.info(
    `[MindOS] runtime pick source=${runtimePick.source} root=${runtimePick.projectRoot ?? '—'} version=${runtimePick.version ?? '—'}${runtimePick.reason ? ` reason=${runtimePick.reason}` : ''}`,
  );

  let projectRoot: string | null = runtimeRes.projectRoot;
  if (!projectRoot && runtimeRes.needsInstallFallback) {
    projectRoot = runtimeRes.userCandidatePath;
    if (!projectRoot) {
      splashStatus({ message: zh ? '正在安装 MindOS...' : 'Installing MindOS...' });
      try {
        projectRoot = await installMindosWithPrivateNode(nodePath, (status) => {
          if (status === 'installing') {
            splashStatus({ message: zh ? '正在安装 MindOS（首次约需 1-2 分钟）...' : 'Installing MindOS (first time, ~1-2 min)...' });
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        splashStatus({
          error: zh ? `MindOS 安装失败: ${msg}` : `MindOS install failed: ${msg}`,
          actions: [
            { id: 'retry', label: 'retry', primary: true },
            { id: 'switch-remote', label: 'switchRemote' },
            { id: 'quit', label: 'quit' },
          ],
        });
        return null;
      }
    }
  }

  if (!projectRoot) {
    splashStatus({
      error: zh ? '未找到可运行的 MindOS 目录' : 'No runnable MindOS installation found',
      actions: [
        { id: 'retry', label: 'retry', primary: true },
        { id: 'switch-remote', label: 'switchRemote' },
        { id: 'quit', label: 'quit' },
      ],
    });
    return null;
  }

  const npxPath = getNpxPath(nodePath);

  // 3. CLI conflict check — mindos.pid can be stale; must not loadURL before /api/health works
  const conflict = checkCliConflict();
  if (conflict.running && conflict.webPort != null) {
    const healthy = await verifyMindOsWebListening(conflict.webPort);
    if (healthy) {
      splashStatus({ status: 'connecting' });
      currentWebPort = conflict.webPort;
      currentMcpPort = conflict.mcpPort;
      return `http://127.0.0.1:${conflict.webPort}`;
    }
    console.warn(
      '[MindOS] mindos.pid suggests a running CLI but /api/health did not succeed — starting a local server from the bundled runtime.',
    );
  }

  // 4. Ensure app is built (first run or after update — npm package has no .next)
  //    Check for valid build (BUILD_ID or standalone/server.js), not just .next dir existence.
  //    An incomplete .next (interrupted build, empty dir) would let Next.js crash at startup.
  const appDir = path.join(projectRoot, 'app');
  const nextDir = path.join(appDir, '.next');
  if (!isNextBuildCurrent(appDir, projectRoot)) {
    splashStatus({ message: zh ? '正在构建 MindOS（首次约需 1-2 分钟）...' : 'Building MindOS (first run, ~1-2 min)...' });
    try {
      const enrichedEnv = getEnrichedEnv(nodePath);
      // Step 4a: Install app dependencies
      const npmBin = path.join(path.dirname(nodePath), 'npm');
      if (existsSync(npmBin) && existsSync(path.join(appDir, 'package.json'))) {
        splashStatus({ message: zh ? '正在安装依赖...' : 'Installing dependencies...' });
        await spawnWithEnv(npmBin, ['install'], appDir, enrichedEnv, 300000);
      }
      // Step 4b: Generate renderer index (needed before build)
      const genScript = path.join(projectRoot, 'scripts', 'gen-renderer-index.js');
      if (existsSync(genScript)) {
        await spawnWithEnv(nodePath, [genScript], projectRoot, enrichedEnv, 30000);
      }
      // Step 4c: Run next build
      splashStatus({ message: zh ? '正在编译前端（约需 1-2 分钟）...' : 'Compiling frontend (~1-2 min)...' });
      const nextBin = path.join(appDir, 'node_modules', '.bin', 'next');
      const buildBin = existsSync(nextBin) ? nextBin : npxPath;
      const buildArgs = existsSync(nextBin) ? ['build'] : ['next', 'build'];
      await spawnWithEnv(buildBin, buildArgs, appDir, enrichedEnv, 600000);
      // Write build version stamp
      try {
        const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
        writeFileSync(path.join(nextDir, BUILD_VERSION_FILE), version, 'utf-8');
      } catch (stampErr) { console.warn('[MindOS] Failed to write build version stamp:', stampErr); }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      splashStatus({
        error: zh ? `构建失败: ${msg}` : `Build failed: ${msg}`,
        actions: [
          { id: 'retry', label: 'retry', primary: true },
          { id: 'switch-remote', label: 'switchRemote' },
          { id: 'quit', label: 'quit' },
        ],
      });
      return null;
    }
  }

  splashStatus({ status: 'starting' });

  // 5. Find ports + spawn (retry once if port was stolen between check and bind)
  let webPort: number;
  let mcpPort: number;
  try {
    webPort = await findAvailablePort(config.port || DEFAULT_WEB_PORT);
    mcpPort = await findAvailablePort(config.mcpPort || DEFAULT_MCP_PORT);
  } catch (portErr) {
    // Port range exhausted — likely orphaned processes from a previous crash.
    // Kill them and retry instead of showing a dead-end error.
    ProcessManager.cleanupOrphanedChildren();
    try {
      webPort = await findAvailablePort(config.port || DEFAULT_WEB_PORT);
      mcpPort = await findAvailablePort(config.mcpPort || DEFAULT_MCP_PORT);
    } catch {
      const basePort = config.port || DEFAULT_WEB_PORT;
      splashStatus({
        error: zh
          ? `端口 ${basePort}-${basePort + 9} 均被占用。\n请关闭其他占用这些端口的程序，或在终端运行:\n  lsof -ti:${basePort} | xargs kill`
          : `Ports ${basePort}-${basePort + 9} are all in use.\nClose other programs using these ports, or run:\n  lsof -ti:${basePort} | xargs kill`,
        actions: [
          { id: 'retry', label: 'retry', primary: true },
          { id: 'quit', label: 'quit' },
        ],
      });
      return null;
    }
  }

  const createProcessManager = (wp: number, mp: number) => new ProcessManager({
    nodePath, npxPath, projectRoot, webPort: wp, mcpPort: mp,
    mindRoot:
      getEffectiveMindRootFromConfig(config) ||
      path.join(app.getPath('home'), 'MindOS', 'mind'),
    authToken: config.authToken,
    webPassword: typeof config.webPassword === 'string' ? config.webPassword : undefined,
    verbose: false,
    env: getEnrichedEnv(nodePath),
  });

  processManager = createProcessManager(webPort, mcpPort);

  try {
    await processManager.start();
  } catch (startErr) {
    const msg = startErr instanceof Error ? startErr.message : '';
    // Port stolen between findAvailablePort and actual bind — retry once with fresh ports
    if (msg.includes('EADDRINUSE') || msg.includes('address already in use')) {
      console.warn('[MindOS] Port conflict detected, retrying with fresh ports...');
      try { await processManager.stop(); } catch { /* best-effort */ }
      webPort = await findAvailablePort(webPort + 1);
      mcpPort = await findAvailablePort(mcpPort + 1);
      processManager = createProcessManager(webPort, mcpPort);
      await processManager.start(); // let this throw if it fails again
    } else {
      throw startErr;
    }
  }

  // Read effective ports (may have changed during EADDRINUSE retry or respawn)
  currentWebPort = processManager.webPort;
  currentMcpPort = processManager.mcpPort;
  webPort = currentWebPort;
  mcpPort = currentMcpPort;

  let crashDialogShown = false;
  let mcpFailed = false;
  let startupComplete = false;  // Only show crash dialog after successful startup

  processManager.on('mcp-port-blocked', async (blockedPort: number) => {
    const zh = navigator_lang() === 'zh';
    // Find a suggested alternative port
    let suggestedPort: number | null = null;
    try {
      const { findAvailablePort: findPort } = await import('./port-finder');
      suggestedPort = await findPort(blockedPort + 1);
    } catch { /* fallback to no suggestion */ }

    const title = zh ? 'MCP 端口被占用' : 'MCP Port Unavailable';
    const detail = suggestedPort
      ? (zh
        ? `端口 ${blockedPort} 被其他程序占用，MCP 服务无法启动。\n\n推荐切换到端口 ${suggestedPort}（当前可用）。\n已安装的 AI 助手配置将自动更新。`
        : `Port ${blockedPort} is occupied by another program. MCP cannot start.\n\nSuggested alternative: port ${suggestedPort} (currently available).\nInstalled AI tool configurations will be updated automatically.`)
      : (zh
        ? `端口 ${blockedPort} 被其他程序占用，MCP 服务无法启动。\n\n请关闭占用该端口的程序后重启 MindOS。`
        : `Port ${blockedPort} is occupied by another program. MCP cannot start.\n\nClose the program using that port and restart MindOS.`);

    const buttons = suggestedPort
      ? [zh ? `使用端口 ${suggestedPort}` : `Use port ${suggestedPort}`, zh ? '稍后处理' : 'Dismiss']
      : [zh ? '确定' : 'OK'];

    const result = await dialog.showMessageBox(mainWindow!, {
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
        processManager!.startMcpOnPort(suggestedPort);
        console.info(`[MindOS] MCP restarted on port ${suggestedPort}`);
        updateTrayMenu(currentMode, 'running', undefined, processManager?.webPort, suggestedPort);
        // Auto-update MCP client configs that use http transport with the old port
        updateMcpClientConfigs(blockedPort, suggestedPort);
      } catch (err) {
        console.error('[MindOS] Failed to start MCP on suggested port:', err);
      }
    }
  });

  processManager.on('crash', (which: string, count: number, stderrLines?: string[]) => {
    if (which === 'mcp' && count >= 3) {
      mcpFailed = true;
      updateTrayMenu(currentMode, 'running', undefined, processManager?.webPort, processManager?.mcpPort);
    }
    // During startup, crashes are handled by start()'s throw → splash error.
    // Only show crash dialog for post-startup failures.
    if (which === 'web' && count >= 3 && !crashDialogShown && startupComplete) {
      // Check if MindOS update is in progress — don't show crash dialog during update
      const updateStatusPath = path.join(CONFIG_DIR, 'update-status.json');
      let isUpdating = false;
      try {
        if (existsSync(updateStatusPath)) {
          const status = JSON.parse(readFileSync(updateStatusPath, 'utf-8'));
          isUpdating = status.stage && status.stage !== 'done' && status.stage !== 'failed';
        }
      } catch { /* ignore */ }

      if (isUpdating) {
        // Update in progress — inject overlay and wait for new server
        const zh = navigator_lang() === 'zh';
        injectOverlay('mindos-update-overlay', `
          <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;backdrop-filter:blur(8px)">
            <div style="width:28px;height:28px;border:3px solid rgba(212,149,74,0.3);border-top-color:#d4954a;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:14px"></div>
            <div style="color:#e8e4dc;font-size:18px;font-weight:600">${zh ? 'MindOS 正在更新...' : 'MindOS is Updating...'}</div>
            <div style="color:#8a8275;font-size:13px;margin-top:6px;text-align:center;max-width:300px;line-height:1.5">${zh ? '服务正在重启，完成后将自动刷新。' : 'Server is restarting. Will auto-reload when ready.'}</div>
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
          </div>
        `);
        refreshTray('starting');
        // Poll for server recovery
        activeRecoveryPoll = setInterval(async () => {
          try {
            const effectiveWebPort = processManager?.webPort ?? webPort;
            const res = await fetch(`http://127.0.0.1:${effectiveWebPort}/api/health`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
              clearInterval(activeRecoveryPoll!);
              activeRecoveryPoll = null;
              mainWindow?.loadURL(
                resolveLocalMindOsBrowseUrl(`http://127.0.0.1:${effectiveWebPort}`),
              );
              refreshTray('running');
            }
          } catch { /* still down */ }
        }, 3000);
        // Timeout after 5 minutes
        setTimeout(() => { if (activeRecoveryPoll) { clearInterval(activeRecoveryPoll); activeRecoveryPoll = null; } }, 300_000);
      } else {
        crashDialogShown = true;
        const zh = navigator_lang() === 'zh';
        const stderr = stderrLines?.slice(-5).join('\n') || '';
        const hasModuleError = stderr.includes('MODULE_NOT_FOUND') || stderr.includes('Cannot find module');
        const hint = hasModuleError
          ? (zh ? '\n\n可能原因：构建产物过期。请在终端运行 mindos start 重新编译。' : '\n\nLikely cause: stale build. Run "mindos start" in terminal to rebuild.')
          : (zh ? '\n\n请检查 Node.js 环境后重启。' : '\n\nPlease check your Node.js environment and restart.');
        dialog.showErrorBox(
          zh ? 'MindOS 服务崩溃' : 'MindOS Service Crashed',
          (zh ? 'Web 服务连续崩溃 3 次。' : 'The web server crashed 3 times.')
            + hint + '\n\n' + (zh ? '详细日志：~/.mindos/crash.log' : 'Details: ~/.mindos/crash.log') + (stderr ? '\n\n--- Last output ---\n' + stderr : ''),
        );
      }
    }
  });

  processManager.on('status-change', (status: string) => {
    refreshTray(status as 'starting' | 'running' | 'error');
  });

  try {
    await processManager.start();
    startupComplete = true;
    splashStatus({ status: 'ready', done: true });
    return `http://127.0.0.1:${webPort}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    splashStatus({
      error: msg,
      actions: [
        { id: 'retry', label: 'retry', primary: true },
        { id: 'switch-remote', label: 'switchRemote' },
        { id: 'quit', label: 'quit' },
      ],
    });
    return null;
  }
}

// ── Remote Mode ──

async function startRemoteMode(): Promise<string | null> {
  splashStatus({ status: 'connecting' });
  const savedAddress = getActiveRemoteConnection();
  if (savedAddress) {
    try {
      const result = await testConnection(savedAddress);
      if (result.status === 'online') {
        // If auth required, try saved password for seamless reconnect
        if (result.authRequired) {
          const password = loadPassword(savedAddress);
          if (password) {
            try {
              const res = await fetch(`${savedAddress}/api/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
              });
              if (res.ok) {
                currentRemoteAddress = savedAddress;
                splashStatus({ status: 'ready', done: true });
                return savedAddress;
              }
            } catch { /* saved password failed, fall through */ }
          }
          // No password or auth failed → show connect window
        } else {
          currentRemoteAddress = savedAddress;
          splashStatus({ status: 'ready', done: true });
          return savedAddress;
        }
      }
    } catch { /* fall through */ }
  }
  // Need user input — close splash, show connect window
  closeSplash();
  return showConnectWindow();
}

// ── Helper ──

function navigator_lang(): 'zh' | 'en' {
  const locale = app.getLocale();
  return locale?.startsWith('zh') ? 'zh' : 'en';
}

/**
 * Scan known MCP client config files and replace old port URLs with new port.
 * Only touches entries where url contains `localhost:oldPort/mcp` (the mindos MCP endpoint).
 * Safe for stdio configs (no url field → no change).
 */
function updateMcpClientConfigs(oldPort: number, newPort: number): void {
  const home = app.getPath('home');
  const resolve = (p: string) => p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
  // All known MCP client config paths (global only — project configs are repo-specific)
  const configPaths = [
    '~/.claude.json',
    '~/.cursor/mcp.json',
    '~/.codeium/windsurf/mcp_config.json',
    '~/.trae/mcp.json',
    '~/.gemini/settings.json',
    '~/.openclaw/mcp.json',
    '~/.codebuddy/mcp.json',
    '~/.mindos/mcp.json',
  ];
  const oldPattern = `localhost:${oldPort}/mcp`;
  const newUrl = `localhost:${newPort}/mcp`;
  let updated = 0;
  for (const rel of configPaths) {
    const abs = resolve(rel);
    try {
      if (!existsSync(abs)) continue;
      const raw = readFileSync(abs, 'utf-8');
      if (!raw.includes(oldPattern)) continue;
      const replaced = raw.split(oldPattern).join(newUrl);
      writeFileSync(abs, replaced, 'utf-8');
      updated++;
      console.info(`[MindOS] Updated MCP port in ${rel}: ${oldPort} → ${newPort}`);
    } catch (err) {
      console.warn(`[MindOS] Failed to update ${rel}:`, err instanceof Error ? err.message : err);
    }
  }
  if (updated > 0) {
    console.info(`[MindOS] Updated ${updated} MCP client config(s)`);
  }
}

/** Update tray with current state — always includes ports/address */
function refreshTray(status: 'starting' | 'running' | 'error'): void {
  updateTrayMenu(currentMode, status, currentRemoteAddress, currentWebPort, currentMcpPort);
}

/**
 * Detect and clean up a conflicting CLI launchd service (com.mindos.app).
 *
 * When users delete MindOS.app from Finder without quitting first, the CLI's
 * launchd daemon keeps running and auto-restarting `mindos start`, occupying
 * all available ports. Desktop needs to stop it before starting its own services.
 *
 * Only acts on macOS. Only stops the service if it exists and conflicts with
 * Desktop's own startup (i.e. Desktop is about to manage its own processes).
 */
function cleanupConflictingLaunchdService(): void {
  if (process.platform !== 'darwin') return;

  try {
    const { execSync: exec } = require('child_process');

    // Check if com.mindos.app service is registered with launchd
    let serviceExists = false;
    try {
      const output = exec('launchctl list com.mindos.app', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      });
      serviceExists = output.includes('com.mindos.app');
    } catch {
      // launchctl list exits non-zero if service doesn't exist — that's fine
      return;
    }

    if (!serviceExists) return;

    console.warn('[MindOS] Detected conflicting launchd service com.mindos.app — stopping it');

    // Step 1: bootout the service so launchd stops restarting it
    try {
      exec(`launchctl bootout gui/$(id -u)/com.mindos.app`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
      console.info('[MindOS] Stopped launchd service com.mindos.app');
    } catch (err) {
      // Try `launchctl remove` as fallback (works on some macOS versions)
      try {
        exec('launchctl remove com.mindos.app', {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        });
        console.info('[MindOS] Removed launchd service com.mindos.app via fallback');
      } catch {
        console.warn('[MindOS] Could not stop launchd service:', err instanceof Error ? err.message : err);
      }
    }

    // Step 2: Remove the plist file to prevent re-registration on next login
    const plistPath = path.join(app.getPath('home'), 'Library', 'LaunchAgents', 'com.mindos.app.plist');
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
    try {
      exec('pkill -f "node_modules/@geminilight/mindos/bin/cli.js start"', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      });
    } catch { /* no matching processes — fine */ }
    // Also kill Next.js workers spawned by the CLI
    try {
      exec('pkill -f "node_modules/@geminilight/mindos/app/node_modules/.bin/next"', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      });
    } catch { /* no matching processes — fine */ }

    // Step 4: Brief wait for ports to release
    exec('sleep 1', { stdio: 'ignore' });

  } catch (err) {
    // Non-critical — if cleanup fails, findAvailablePort will still work as fallback
    console.warn('[MindOS] launchd cleanup failed:', err instanceof Error ? err.message : err);
  }
}

/** Spawn a process with enriched env, wait for exit. Rejects on non-zero or timeout. */
function spawnWithEnv(bin: string, args: string[], cwd: string, env: Record<string, string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawnChild(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

    // Log last output for diagnostics on failure
    let lastOutput = '';
    proc.stdout?.on('data', (d: Buffer) => { lastOutput = d.toString().trim().split('\n').pop() || ''; });
    proc.stderr?.on('data', (d: Buffer) => { lastOutput = d.toString().trim().split('\n').pop() || ''; });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${path.basename(bin)} ${args[0] || ''} timed out after ${Math.round(timeoutMs / 1000)}s\nLast output: ${lastOutput}`));
    }, timeoutMs);
    proc.on('exit', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0 || code === null) resolve();
      else reject(new Error(`${path.basename(bin)} ${args[0] || ''} exited with code ${code}\n${lastOutput}`));
    });
    proc.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
}

// ── Tray Action: Switch Mode (show selection window, then switch if different) ──

let isSwitchingMode = false;
async function handleChangeMode(): Promise<void> {
  if (isSwitchingMode) return;
  isSwitchingMode = true;
  try {
    const selectedMode = await showModeSelectWindow();
    if (!selectedMode || selectedMode === currentMode) return;
    await switchToMode(selectedMode);
  } finally {
    isSwitchingMode = false;
  }
}

// ── Tray Action: Switch Server (remote mode — show connect window) ──

async function handleSwitchServer(): Promise<void> {
  const url = await showConnectWindow();
  if (!url) return; // user cancelled

  if (connectionMonitor) connectionMonitor.stop();
  currentRemoteAddress = url;
  setupConnectionMonitor(url);
  mainWindow?.loadURL(url);
  refreshTray('running');
}

// ── Core: switch from current mode to target mode with preheat ──

async function switchToMode(targetMode: 'local' | 'remote'): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const oldMode = currentMode;
  const zh = navigator_lang() === 'zh';

  // 1. Overlay on current content
  await injectOverlay('mindos-switch-overlay', `
    <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:system-ui;color:white;font-size:16px;backdrop-filter:blur(4px)">
      ${zh ? '正在切换...' : 'Switching...'}
    </div>
  `);

  // 2. Preheat: keep old alive, start new
  const oldPM = processManager;
  const oldCM = connectionMonitor;
  processManager = null;
  connectionMonitor = null;
  if (targetMode === 'local') { clearActiveTunnel(); currentRemoteAddress = undefined; }
  else { currentWebPort = undefined; currentMcpPort = undefined; }
  currentMode = targetMode;
  invalidateConfig();

  let url: string | null = null;
  try {
    if (targetMode === 'local') {
      url = await startLocalMode();
    } else {
      url = await startRemoteMode();
      if (url) setupConnectionMonitor(url);
    }
  } catch { /* handled below */ }

  // 3. Apply
  if (url) {
    saveDesktopMode(targetMode);
    const openUrl = targetMode === 'local' ? resolveLocalMindOsBrowseUrl(url) : url;
    mainWindow.loadURL(openUrl);
    refreshTray('running');
    if (oldPM) oldPM.stop().catch(() => {});
    if (oldCM) oldCM.stop();
  } else {
    // Revert silently
    currentMode = oldMode;
    processManager = oldPM;
    connectionMonitor = oldCM;
    await removeOverlay('mindos-switch-overlay');
    refreshTray(processManager ? 'running' : 'error');
  }
}

// ── Tray Action: Restart Services ──

let isRestarting = false;
async function handleRestartServices(): Promise<void> {
  if (currentMode !== 'local' || isRestarting) return;
  isRestarting = true;
  const zh = navigator_lang() === 'zh';

  if (mainWindow && !mainWindow.isDestroyed()) {
    await injectOverlay('mindos-switch-overlay', `
      <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:system-ui;color:white;font-size:16px;backdrop-filter:blur(4px)">
        ${zh ? '正在重启...' : 'Restarting...'}
      </div>
    `);
  }

  try {
    if (processManager) {
      // Desktop owns the processes — restart them
      await processManager.restart();
      refreshTray('running');
      if (mainWindow && currentWebPort !== undefined) {
        mainWindow.loadURL(
          resolveLocalMindOsBrowseUrl(`http://127.0.0.1:${currentWebPort}`),
        );
      } else {
        mainWindow?.reload();
      }
    } else {
      // Connected to external CLI — do a full re-launch
      const url = await startLocalMode();
      if (url && mainWindow) {
        mainWindow.loadURL(resolveLocalMindOsBrowseUrl(url));
        refreshTray('running');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await removeOverlay('mindos-switch-overlay');
    dialog.showErrorBox(zh ? '重启失败' : 'Restart Failed', msg);
  } finally {
    isRestarting = false;
  }
}

// ── Tray Callbacks ──

const trayCallbacks: TrayCallbacks = {
  onChangeMode: handleChangeMode,
  onOpenMindRoot: () => {
    const configured = getEffectiveMindRootFromConfig(loadConfig());
    shell.openPath(configured || path.join(app.getPath('home'), 'MindOS', 'mind'));
  },
  onRestartServices: handleRestartServices,
  onSwitchServer: handleSwitchServer,
  onRefreshCliShim: () => { refreshMindosCliAndNotify(mainWindow); },
};

// ── IPC Handlers ──

function setupIPC(): void {
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    mode: currentMode,
  }));

  ipcMain.handle('open-mindroot', () => {
    const configured = getEffectiveMindRootFromConfig(loadConfig());
    shell.openPath(configured || path.join(app.getPath('home'), 'MindOS', 'mind'));
  });

  ipcMain.handle('switch-mode', () => handleChangeMode());
  ipcMain.handle('restart-services', () => handleRestartServices());
  ipcMain.handle('switch-server', () => handleSwitchServer());

  // Uninstall: move the Desktop .app bundle to Trash, then quit.
  // Server-side cleanup (stop services, remove config) is handled by /api/uninstall
  // before this IPC is called.
  ipcMain.handle('uninstall-app', async () => {
    try {
      // Stop managed child processes first
      processManager?.stopAll();

      // Determine app bundle path per platform:
      // macOS:   /Applications/MindOS.app/Contents/MacOS/MindOS → /Applications/MindOS.app
      // Windows: C:\Program Files\MindOS\MindOS.exe → C:\Program Files\MindOS\
      // Linux AppImage: /tmp/.mount_xxx/mindos → use APPIMAGE env for the real .AppImage file
      // Linux deb/rpm:  /opt/MindOS/mindos → /opt/MindOS/
      let appPath = app.getPath('exe');
      if (process.platform === 'darwin') {
        const appMatch = appPath.match(/^(.*?\.app)(\/|$)/);
        if (appMatch) appPath = appMatch[1];
      } else if (process.platform === 'linux') {
        // AppImage sets APPIMAGE env to the actual .AppImage file path
        appPath = process.env.APPIMAGE || path.dirname(appPath);
      } else {
        // Windows: delete the installation directory
        appPath = path.dirname(appPath);
      }

      // moveItemToTrash returns boolean (true = success)
      const moved = shell.moveItemToTrash(appPath);
      if (!moved) {
        return { ok: false, error: `Failed to move ${appPath} to Trash. You may need to delete it manually.` };
      }

      // Quit after a brief delay to let the IPC response reach the renderer
      setTimeout(() => app.quit(), 500);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ── Connection Monitor ──

/** Inject or remove a full-screen overlay on the main window.
 *  id must be a safe CSS identifier (alphanumeric + hyphens only). */
async function injectOverlay(id: string, html: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Sanitize id — only allow safe CSS identifier characters
  if (!/^[a-zA-Z][\w-]*$/.test(id)) return;
  const safeId = JSON.stringify(id);
  try {
    await mainWindow.webContents.executeJavaScript(`
      (function() {
        var _id = ${safeId};
        if (document.getElementById(_id)) return;
        const d = document.createElement('div');
        d.id = _id;
        d.innerHTML = ${JSON.stringify(html)};
        document.body.appendChild(d);
      })()
    `);
  } catch { /* page may not be ready */ }
}

async function removeOverlay(id: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!/^[a-zA-Z][\w-]*$/.test(id)) return;
  try {
    await mainWindow.webContents.executeJavaScript(
      `document.getElementById(${JSON.stringify(id)})?.remove()`
    );
  } catch { /* ignore */ }
}

function setupConnectionMonitor(url: string): void {
  if (connectionMonitor) connectionMonitor.stop();
  connectionMonitor = new ConnectionMonitor(url, {
    onLost: () => {
      mainWindow?.webContents.send('connection-lost');
      refreshTray('error');
      // Inject reconnection overlay
      const zh = navigator_lang() === 'zh';
      injectOverlay('mindos-disconnect-overlay', `
        <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;backdrop-filter:blur(6px)">
          <div style="color:#e8e4dc;font-size:18px;margin-bottom:8px">${zh ? '⚠ 与服务器的连接已断开' : '⚠ Connection Lost'}</div>
          <div style="color:#8a8275;font-size:13px;margin-bottom:20px">${zh ? '正在尝试重新连接...' : 'Attempting to reconnect...'}</div>
          <div style="display:flex;gap:8px">
            <button onclick="window.mindos?.switchMode()" style="padding:8px 18px;border-radius:8px;border:1px solid rgba(232,228,220,0.15);background:rgba(255,255,255,0.08);color:#e8e4dc;font-size:13px;cursor:pointer">${zh ? '切换到本地模式' : 'Switch to Local'}</button>
          </div>
        </div>
      `);
    },
    onRestored: () => {
      mainWindow?.webContents.send('connection-restored');
      removeOverlay('mindos-disconnect-overlay');
      mainWindow?.reload();
      refreshTray('running');
    },
  });
  connectionMonitor.start();
}

// ── Splash Action Handler ──

let isBooting = false;
async function handleSplashAction(actionId: string): Promise<void> {
  switch (actionId) {
    case 'install-node':
      shell.openExternal('https://nodejs.org/');
      break;
    case 'switch-remote':
      currentMode = 'remote';
      saveDesktopMode('remote');
      closeSplash();
      await bootApp();
      break;
    case 'retry':
      if (isBooting) break;
      isBooting = true;
      splashStatus({ status: 'detecting' });
      try { await bootApp(); } finally { isBooting = false; }
      break;
    case 'quit':
      app.quit();
      break;
    case 'select-mode': {
      closeSplash();
      const mode = await showModeSelectWindow();
      if (mode) {
        currentMode = mode;
        saveDesktopMode(mode, { allowSeedWebSetup: true });
      }
      // Create new splash for boot
      splashWindow = createSplash();
      await bootApp();
      break;
    }
  }
}

// ── Boot App (resolve URL + show main window) ──

async function bootApp(): Promise<void> {
  let url: string | null = null;

  try {
    if (currentMode === 'local') {
      url = await startLocalMode();
    } else {
      url = await startRemoteMode();
      if (url) setupConnectionMonitor(url);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    splashStatus({
      error: msg,
      actions: [
        { id: 'retry', label: 'retry', primary: true },
        { id: 'quit', label: 'quit' },
      ],
    });
    return;
  }

  if (!url) return; // splash is showing error + actions, wait for user

  // Create main window
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    setupIPC();
    createTray(mainWindow, trayCallbacks);
    registerShortcuts(mainWindow);
    setupUpdater();
  }

  refreshTray('running');

  const loadUrl = currentMode === 'local' ? resolveLocalMindOsBrowseUrl(url) : url;
  mainWindow.loadURL(loadUrl);

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, failedUrl) => {
    console.error('[MindOS] main window did-fail-load', code, desc, failedUrl);
    closeSplash();
    const zh = navigator_lang() === 'zh';
    void dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: zh ? '页面加载失败' : 'Page failed to load',
      message: zh ? `无法加载：${failedUrl}` : `Could not load: ${failedUrl}`,
      detail: `${desc} (code ${code})\n\n${zh ? '若使用本地模式，请在终端执行 MINDOS_OPEN_DEVTOOLS=1 启动应用以打开开发者工具，或在浏览器访问同一地址对比。' : 'Tip: launch with MINDOS_OPEN_DEVTOOLS=1 to open DevTools, or open the same URL in a browser.'}`,
    });
    mainWindow?.show();
  });

  // Show main + hide splash on each navigation (not just the first)
  let firstLoad = true;
  mainWindow.webContents.on('did-finish-load', () => {
    if (firstLoad) {
      mainWindow?.show();
      closeSplash();
      if (process.env.MINDOS_OPEN_DEVTOOLS === '1') {
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      }
      firstLoad = false;
    }
    // macOS: inject titlebar CSS (navigation resets injected stylesheets, so re-inject)
    if (process.platform === 'darwin') {
      mainWindow?.webContents.insertCSS(`
        html { --electron-mac-titlebar-h: 28px; }
        /* Full-width drag zone at the very top of the window */
        body::before {
          content: '';
          display: block;
          position: fixed;
          top: 0; left: 0; right: 0;
          height: var(--electron-mac-titlebar-h);
          -webkit-app-region: drag;
          z-index: 9999;
          pointer-events: auto;
        }
        /* Buttons/links inside the drag zone must be clickable */
        button, a, input, select, textarea, [role="button"] {
          -webkit-app-region: no-drag;
        }
        /* Activity Bar (rail) + Side Panel: shift down together so separators align */
        [role="toolbar"][aria-label="Navigation"],
        [role="toolbar"][aria-label="Navigation"] ~ aside[role="region"] {
          top: var(--electron-mac-titlebar-h) !important;
          height: calc(100vh - var(--electron-mac-titlebar-h)) !important;
        }
        /* Old sidebar layout fallback */
        .electron-mac-titlebar-pad {
          display: block !important;
          height: var(--electron-mac-titlebar-h);
          -webkit-app-region: drag;
        }
      `);
    }
  });

  // Fallback: if did-finish-load doesn't fire in 10s, show anyway
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      closeSplash();
    }
  }, 10000);
}

// ── App Lifecycle ──

app.whenReady().then(async () => {
  registerMindosConnectProtocol();

  ipcMain.handle('splash:action', (_e, actionId: string) => handleSplashAction(actionId));

  ensureMindosCliShim();
  cleanupOrphanedSshTunnel();
  ProcessManager.cleanupOrphanedChildren();
  cleanupConflictingLaunchdService();

  if (needsDesktopModeSelectAtLaunch()) {
    const mode = await showModeSelectWindow();
    if (!mode) {
      app.quit();
      return;
    }
    currentMode = mode;
    saveDesktopMode(mode, { allowSeedWebSetup: true });
    splashWindow = createSplash();
  } else {
    const disk = readMindOsConfigFileUncached();
    currentMode = disk.desktopMode === 'remote' ? 'remote' : 'local';
    splashWindow = createSplash();
  }

  await bootApp();
});

app.on('window-all-closed', () => { /* tray keeps alive */ });
app.on('activate', () => { if (mainWindow) mainWindow.show(); });

app.on('before-quit', (e) => {
  if (!isQuitting) {
    e.preventDefault();
    isQuitting = true;
    unregisterShortcuts();
    if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow);
    const cleanup = async () => {
      try {
        if (processManager) await processManager.stop();
      } catch { /* best-effort */ }
      if (connectionMonitor) connectionMonitor.stop();
      if (activeRecoveryPoll) { clearInterval(activeRecoveryPoll); activeRecoveryPoll = null; }
      clearActiveTunnel();
      app.exit(0);
    };
    // Must use .then() — event handler cannot be async, but cleanup must complete before exit
    cleanup().catch(() => app.exit(1));
  }
});
