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
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import path from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { ProcessManager } from './process-manager';
import { findAvailablePort } from './port-finder';
import { createTray, updateTrayMenu, type TrayCallbacks } from './tray';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { restoreWindowState, saveWindowState } from './window-state';
import { setupUpdater } from './updater';
import { ConnectionMonitor } from './connection-monitor';
import { showConnectWindow, showModeSelectWindow, getActiveRemoteConnection, loadPassword } from './connect-window';
import { testConnection } from '../../shared/connection';
import { getNodePath, getMindosInstallPath, getNpxPath, getEnrichedEnv } from './node-detect';

// ── Constants ──
const APP_ROOT = app.getAppPath();
const CONFIG_DIR = path.join(app.getPath('home'), '.mindos');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const PID_PATH = path.join(CONFIG_DIR, 'mindos.pid');
const DEFAULT_WEB_PORT = 3456;
const DEFAULT_MCP_PORT = 8781;

// ── Paths ──
const SPLASH_HTML = path.join(APP_ROOT, 'src', 'splash.html');
const SPLASH_PRELOAD = path.join(APP_ROOT, 'dist-electron', 'preload', 'splash-preload.js');
const MAIN_PRELOAD = path.join(APP_ROOT, 'dist-electron', 'preload', 'preload.js');

// ── State ──
let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let connectionMonitor: ConnectionMonitor | null = null;
let isQuitting = false;
let currentMode: 'local' | 'remote' = 'local';
let currentUrl: string | null = null;
let cachedConfig: MindOSConfig | null = null;

// ── Config ──
interface MindOSConfig {
  ai?: Record<string, unknown>;
  mindRoot?: string;
  port?: number;
  mcpPort?: number;
  authToken?: string;
  webPassword?: string;
  desktopMode?: 'local' | 'remote';
  [key: string]: unknown;
}

function loadConfig(): MindOSConfig {
  if (cachedConfig) return cachedConfig;
  try {
    cachedConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return cachedConfig!;
  } catch {
    return {};
  }
}

function invalidateConfig(): void { cachedConfig = null; }

function saveDesktopMode(mode: 'local' | 'remote'): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = loadConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, desktopMode: mode }, null, 2));
  cachedConfig = { ...existing, desktopMode: mode };
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

  splashStatus({ status: 'detecting' });

  // 1. Node.js check
  const nodePath = await getNodePath();
  if (!nodePath) {
    splashStatus({
      error: navigator_lang() === 'zh' ? '未检测到 Node.js' : 'Node.js not found',
      actions: [
        { id: 'install-node', label: 'Open nodejs.org', primary: true },
        { id: 'switch-remote', label: 'switchRemote' },
        { id: 'quit', label: 'quit' },
      ],
    });
    return null;
  }

  // 2. MindOS install check
  const projectRoot = await getMindosInstallPath(nodePath);
  if (!projectRoot) {
    splashStatus({
      error: navigator_lang() === 'zh' ? '未检测到 MindOS CLI\n请运行: npm install -g @geminilight/mindos' : 'MindOS CLI not found\nRun: npm install -g @geminilight/mindos',
      actions: [
        { id: 'retry', label: 'retry', primary: true },
        { id: 'switch-remote', label: 'switchRemote' },
        { id: 'quit', label: 'quit' },
      ],
    });
    return null;
  }

  const npxPath = getNpxPath(nodePath);

  // 3. CLI conflict check
  const conflict = checkCliConflict();
  if (conflict.running) {
    // Just connect to existing — best UX
    splashStatus({ status: 'connecting' });
    return `http://127.0.0.1:${conflict.webPort}`;
  }

  splashStatus({ status: 'starting' });

  // 4. Find ports + spawn
  const webPort = await findAvailablePort(config.port || DEFAULT_WEB_PORT);
  const mcpPort = await findAvailablePort(config.mcpPort || DEFAULT_MCP_PORT);

  processManager = new ProcessManager({
    nodePath, npxPath, projectRoot, webPort, mcpPort,
    mindRoot: config.mindRoot || path.join(app.getPath('home'), 'MindOS', 'mind'),
    authToken: config.authToken,
    verbose: false,
    env: getEnrichedEnv(nodePath),
  });

  let crashDialogShown = false;
  processManager.on('crash', (which: string, count: number) => {
    if (count >= 3 && !crashDialogShown) {
      crashDialogShown = true;
      const zh = navigator_lang() === 'zh';
      dialog.showErrorBox(
        zh ? 'MindOS 服务崩溃' : 'MindOS Service Crashed',
        zh ? `${which} 服务连续崩溃 3 次。请检查 Node.js 环境后重启。` : `The ${which} server crashed 3 times. Please check your Node.js environment and restart.`
      );
    }
  });

  processManager.on('status-change', (status: string) => {
    updateTrayMenu(currentMode, status as 'starting' | 'running' | 'error', webPort, mcpPort);
  });

  try {
    await processManager.start();
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
                splashStatus({ status: 'ready', done: true });
                return savedAddress;
              }
            } catch { /* saved password failed, fall through */ }
          }
          // No password or auth failed → show connect window
        } else {
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

// ── Tray Action: Change Mode (re-show mode selection window) ──

async function handleChangeMode(): Promise<void> {
  const selectedMode = await showModeSelectWindow();
  if (!selectedMode) return; // user cancelled

  // If same mode, do nothing
  if (selectedMode === currentMode) return;

  // Save the new preference
  saveDesktopMode(selectedMode);

  // Use the existing switch logic (preheat + overlay)
  // But first set the target mode correctly
  // handleSwitchMode toggles, so we temporarily set currentMode
  // so the toggle lands on the right target
  currentMode = selectedMode === 'local' ? 'remote' : 'local';
  await handleSwitchMode();
}

// ── Tray Action: Switch Mode (direct toggle local↔remote) ──

async function handleSwitchMode(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const oldMode = currentMode;
  const newMode = oldMode === 'local' ? 'remote' : 'local';
  const zh = navigator_lang() === 'zh';

  // 1. Inject overlay — old content stays visible underneath
  await injectOverlay('mindos-switch-overlay', `
    <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:system-ui;color:white;font-size:16px;backdrop-filter:blur(4px)">
      ${zh ? '正在切换...' : 'Switching...'}
    </div>
  `);

  // 2. Keep old processes alive — start new mode in parallel (preheat)
  const oldProcessManager = processManager;
  const oldConnectionMonitor = connectionMonitor;
  processManager = null;
  connectionMonitor = null;

  currentMode = newMode;
  invalidateConfig();

  // 3. Start new mode (old still running)
  let url: string | null = null;
  try {
    if (newMode === 'local') {
      url = await startLocalMode();
    } else {
      url = await startRemoteMode();
      if (url) setupConnectionMonitor(url);
    }
  } catch { /* handled below */ }

  // 4. Apply result
  if (url) {
    saveDesktopMode(newMode);
    currentUrl = url;
    mainWindow.loadURL(url);
    updateTrayMenu(newMode, 'running');
    // Stop old mode after switching
    if (oldProcessManager) oldProcessManager.stop().catch(() => {});
    if (oldConnectionMonitor) oldConnectionMonitor.stop();
  } else {
    // Failed — revert
    currentMode = oldMode;
    processManager = oldProcessManager;
    connectionMonitor = oldConnectionMonitor;
    await removeOverlay('mindos-switch-overlay');
    dialog.showErrorBox(
      zh ? '切换失败' : 'Switch Failed',
      zh ? '无法启动新模式，已恢复原连接。' : 'Could not start new mode. Restored previous connection.'
    );
  }
}

// ── Tray Action: Restart Services ──

async function handleRestartServices(): Promise<void> {
  if (currentMode !== 'local' || !processManager) return;
  const zh = navigator_lang() === 'zh';

  if (mainWindow && !mainWindow.isDestroyed()) {
    await injectOverlay('mindos-switch-overlay', `
      <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:system-ui;color:white;font-size:16px;backdrop-filter:blur(4px)">
        ${zh ? '正在重启...' : 'Restarting...'}
      </div>
    `);
  }

  try {
    await processManager.restart();
    updateTrayMenu('local', 'running');
    mainWindow?.reload();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(zh ? '重启失败' : 'Restart Failed', msg);
  }
}

// ── Tray Callbacks ──

const trayCallbacks: TrayCallbacks = {
  onSwitchMode: handleSwitchMode,
  onChangeMode: handleChangeMode,
  onOpenMindRoot: () => {
    const config = loadConfig();
    shell.openPath(config.mindRoot || path.join(app.getPath('home'), 'MindOS', 'mind'));
  },
  onRestartServices: handleRestartServices,
};

// ── IPC Handlers ──

function setupIPC(): void {
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    mode: currentMode,
  }));

  ipcMain.handle('open-mindroot', () => {
    const config = loadConfig();
    shell.openPath(config.mindRoot || path.join(app.getPath('home'), 'MindOS', 'mind'));
  });

  ipcMain.handle('switch-mode', () => handleSwitchMode());
  ipcMain.handle('change-mode', () => handleChangeMode());
  ipcMain.handle('restart-services', () => handleRestartServices());
}

// ── Connection Monitor ──

/** Inject or remove a full-screen overlay on the main window */
async function injectOverlay(id: string, html: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.webContents.executeJavaScript(`
      (function() {
        if (document.getElementById('${id}')) return;
        const d = document.createElement('div');
        d.id = '${id}';
        d.innerHTML = ${JSON.stringify(html)};
        document.body.appendChild(d);
      })()
    `);
  } catch { /* page may not be ready */ }
}

async function removeOverlay(id: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.webContents.executeJavaScript(
      `document.getElementById('${id}')?.remove()`
    );
  } catch { /* ignore */ }
}

function setupConnectionMonitor(url: string): void {
  if (connectionMonitor) connectionMonitor.stop();
  connectionMonitor = new ConnectionMonitor(url, {
    onLost: () => {
      mainWindow?.webContents.send('connection-lost');
      updateTrayMenu('remote', 'error');
      // Inject reconnection overlay
      const zh = navigator_lang() === 'zh';
      injectOverlay('mindos-disconnect-overlay', `
        <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;backdrop-filter:blur(6px)">
          <div style="color:#e8e4dc;font-size:18px;margin-bottom:8px">${zh ? '⚠ 与服务器的连接已断开' : '⚠ Connection Lost'}</div>
          <div style="color:#8a8275;font-size:13px;margin-bottom:20px">${zh ? '正在尝试重新连接...' : 'Attempting to reconnect...'}</div>
          <div style="display:flex;gap:8px">
            <button onclick="window.mindosDesktop?.switchMode()" style="padding:8px 18px;border-radius:8px;border:1px solid rgba(232,228,220,0.15);background:rgba(255,255,255,0.08);color:#e8e4dc;font-size:13px;cursor:pointer">${zh ? '切换到本地模式' : 'Switch to Local'}</button>
          </div>
        </div>
      `);
    },
    onRestored: () => {
      mainWindow?.webContents.send('connection-restored');
      removeOverlay('mindos-disconnect-overlay');
      mainWindow?.reload();
      updateTrayMenu('remote', 'running');
    },
  });
  connectionMonitor.start();
}

// ── Splash Action Handler ──

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
      // Reset splash and retry current mode
      splashStatus({ status: 'detecting' });
      if (splashWindow) {
        // Re-show progress
        splashWindow.webContents.send('splash:status', { status: 'detecting' });
      }
      await bootApp();
      break;
    case 'quit':
      app.quit();
      break;
    case 'select-mode': {
      closeSplash();
      const mode = await showModeSelectWindow();
      if (mode) {
        currentMode = mode;
        saveDesktopMode(mode);
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

  currentUrl = url;

  // Create main window
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    setupIPC();
    createTray(mainWindow, trayCallbacks);
    registerShortcuts(mainWindow);
    setupUpdater();
  }

  updateTrayMenu(currentMode, 'running');
  mainWindow.loadURL(url);

  // Wait for content to load, then show main + hide splash
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.show();
    closeSplash();
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
  const config = loadConfig();
  currentMode = config.desktopMode || 'local';

  // 1. Show splash immediately
  splashWindow = createSplash();

  // Register splash action handler
  ipcMain.handle('splash:action', (_e, actionId: string) => handleSplashAction(actionId));

  // 2. First run → mode selection
  if (!config.desktopMode && !existsSync(CONFIG_PATH)) {
    closeSplash();
    const selectedMode = await showModeSelectWindow();
    if (selectedMode) {
      currentMode = selectedMode;
      saveDesktopMode(selectedMode);
    } else {
      currentMode = 'local';
    }
    // Re-create splash for boot
    splashWindow = createSplash();
  }

  // 3. Boot
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
      if (processManager) await processManager.stop();
      if (connectionMonitor) connectionMonitor.stop();
      app.exit(0);
    };
    cleanup();
  }
});
