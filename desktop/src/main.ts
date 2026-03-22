/**
 * MindOS Desktop — Electron Main Process
 *
 * Supports two modes:
 * - Local: spawn Next.js + MCP on this machine
 * - Remote: connect to a remote MindOS server
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execSync } from 'child_process';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { ProcessManager } from './process-manager';
import { findAvailablePort } from './port-finder';
import { createTray, updateTrayMenu } from './tray';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { restoreWindowState, saveWindowState } from './window-state';
import { setupUpdater } from './updater';
import { ConnectionMonitor } from './connection-monitor';
import { showConnectWindow, getActiveRemoteConnection } from './connect-window';
import { testConnection } from '../../shared/connection';

// ── Constants ──
const CONFIG_DIR = path.join(app.getPath('home'), '.mindos');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const PID_PATH = path.join(CONFIG_DIR, 'mindos.pid');
const DEFAULT_WEB_PORT = 3456;
const DEFAULT_MCP_PORT = 8781;

// ── State ──
let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let connectionMonitor: ConnectionMonitor | null = null;
let isQuitting = false;
let currentMode: 'local' | 'remote' = 'local';
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

/** Invalidate cached config (call after config changes) */
function invalidateConfig(): void {
  cachedConfig = null;
}

/**
 * Resolve the absolute path to node binary.
 * Tries: env var → NVM default → common system paths → shell detection.
 * Returns null if not found, allowing caller to handle gracefully.
 */
export function getNodePath(): string | null {
  // 1. Explicit env var
  if (process.env.MINDOS_NODE_BIN && existsSync(process.env.MINDOS_NODE_BIN)) {
    return process.env.MINDOS_NODE_BIN;
  }

  // 2. NVM: resolve via alias/default symlink
  const home = app.getPath('home');
  const nvmCurrent = path.join(home, '.nvm', 'current', 'bin', 'node');
  if (existsSync(nvmCurrent)) return nvmCurrent;

  // 3. NVM: try direct version directories (common on macOS)
  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    // Find the latest version directory
    const fs = require('fs');
    if (existsSync(nvmVersionsDir)) {
      const versions = fs.readdirSync(nvmVersionsDir)
        .filter((v: string) => v.startsWith('v'))
        .sort().reverse();
      for (const ver of versions) {
        const nodePath = path.join(nvmVersionsDir, ver, 'bin', 'node');
        if (existsSync(nodePath)) return nodePath;
      }
    }
  } catch { /* ignore */ }

  // 4. fnm
  const fnmDir = process.env.FNM_DIR || path.join(home, '.fnm');
  try {
    const fnmAliases = path.join(fnmDir, 'aliases', 'default');
    if (existsSync(fnmAliases)) {
      const ver = readFileSync(fnmAliases, 'utf-8').trim();
      const fnmNode = path.join(fnmDir, 'node-versions', ver, 'installation', 'bin', 'node');
      if (existsSync(fnmNode)) return fnmNode;
    }
  } catch { /* ignore */ }

  // 5. Common system paths (including Intel Homebrew)
  const systemPaths = [
    '/usr/local/bin/node',           // Intel Homebrew
    '/opt/homebrew/bin/node',        // Apple Silicon Homebrew
    '/usr/bin/node',                 // System
    '/opt/local/bin/node',           // MacPorts
    path.join(home, '.local/share/fnm/node'), // fnm direct
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  // 6. Try shell detection with proper PATH
  const shells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
  for (const shell of shells) {
    if (!existsSync(shell)) continue;
    try {
      // Run shell as login shell to load profile
      const result = execSync(
        `${shell} -il -c "which node" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000, env: process.env }
      ).trim();
      if (result && existsSync(result)) return result;
    } catch { /* ignore */ }
  }

  // 7. Last resort: `which node`
  try {
    const result = execSync('which node', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (result && existsSync(result)) return result;
  } catch { /* ignore */ }

  // Return null instead of throwing, let caller handle gracefully
  return null;
}

/**
 * Show dialog when Node.js is required but not found.
 * Returns false if user cancels or chooses remote mode.
 */
async function showNodeRequiredDialog(): Promise<'install' | 'remote' | 'cancel'> {
  const result = await dialog.showMessageBox(mainWindow || undefined, {
    type: 'warning',
    title: 'Node.js Required',
    message: 'Node.js ≥20 is required to run MindOS locally.',
    detail: 'You can:\n• Install Node.js from nodejs.org (recommended)\n• Switch to Remote mode to connect to a MindOS server',
    buttons: ['Open nodejs.org', 'Switch to Remote', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });

  if (result.response === 0) return 'install';
  if (result.response === 1) return 'remote';
  return 'cancel';
}

/**
 * Resolve npx absolute path from node path.
 * npx lives in the same bin/ directory as node.
 */
function getNpxPath(nodePath: string): string {
  const binDir = path.dirname(nodePath);
  const npx = path.join(binDir, 'npx');
  if (existsSync(npx)) return npx;
  // Fallback: try system npx
  try {
    const result = execSync('which npx', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (result && existsSync(result)) return result;
  } catch { /* ignore */ }
  return 'npx'; // last resort
}

function getProjectRoot(): string {
  // In development: __dirname is desktop/dist-electron
  // In production: resources/app/desktop/dist-electron
  const devRoot = path.resolve(__dirname, '..', '..');
  if (existsSync(path.join(devRoot, 'package.json'))) return devRoot;
  // Packaged app
  if (process.resourcesPath) {
    return path.resolve(process.resourcesPath, 'app');
  }
  return devRoot;
}

// ── CLI Conflict Detection ──
function checkCliConflict(): { running: boolean; webPort?: number; mcpPort?: number } {
  try {
    if (!existsSync(PID_PATH)) return { running: false };
    const pids = readFileSync(PID_PATH, 'utf-8')
      .trim()
      .split('\n')
      .map(Number)
      .filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(pid, 0); // Check if alive (signal 0 = test only)
        const config = loadConfig();
        return {
          running: true,
          webPort: config.port || DEFAULT_WEB_PORT,
          mcpPort: config.mcpPort || DEFAULT_MCP_PORT,
        };
      } catch { /* process not running */ }
    }
    return { running: false };
  } catch {
    return { running: false };
  }
}

// ── Window Creation ──
function createWindow(): BrowserWindow {
  const savedState = restoreWindowState();

  const win = new BrowserWindow({
    width: savedState?.width ?? 1200,
    height: savedState?.height ?? 800,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 800,
    minHeight: 600,
    title: 'MindOS',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    webPreferences: {
preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  // Restore maximized state
  if (savedState?.maximized) {
    win.maximize();
  }

  win.once('ready-to-show', () => win.show());

  // macOS: hide window instead of closing
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('resize', () => saveWindowState(win));
  win.on('move', () => saveWindowState(win));

  return win;
}

// ── Show Mode Selection Window ──
async function showModeSelection(): Promise<'local' | 'remote' | null> {
  // Import and use the enhanced connect window for mode selection
  const { showModeSelectWindow } = await import('./connect-window');
  return showModeSelectWindow(mainWindow || undefined);
}

// ── Local Mode ──
async function startLocalMode(): Promise<string | null> {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const nodePath = getNodePath();

  // Check if Node.js is available
  if (!nodePath) {
    const choice = await showNodeRequiredDialog();
    if (choice === 'install') {
      shell.openExternal('https://nodejs.org/');
    }
    if (choice === 'remote') {
      // Switch to remote mode
      currentMode = 'remote';
      invalidateConfig();
      return startRemoteMode();
    }
    return null;
  }

  const npxPath = getNpxPath(nodePath);

  // Check CLI conflict
  const conflict = checkCliConflict();
  if (conflict.running) {
    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'MindOS CLI Running',
      message: `MindOS CLI is already running on port ${conflict.webPort}.`,
      buttons: ['Connect to Existing', 'Close CLI & Take Over'],
      defaultId: 0,
    });

    if (result.response === 0) {
      return `http://127.0.0.1:${conflict.webPort}`;
    }

    // Kill CLI processes
    try {
      const pids = readFileSync(PID_PATH, 'utf-8').trim().split('\n').map(Number).filter(Boolean);
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
      }
      await new Promise((r) => setTimeout(r, 2000));
    } catch { /* ignore */ }
  }

  // Find available ports
  const webPort = await findAvailablePort(config.port || DEFAULT_WEB_PORT);
  const mcpPort = await findAvailablePort(config.mcpPort || DEFAULT_MCP_PORT);

  // Spawn processes
  processManager = new ProcessManager({
    nodePath,
    npxPath,
    projectRoot,
    webPort,
    mcpPort,
    mindRoot: config.mindRoot || path.join(app.getPath('home'), 'MindOS', 'mind'),
    authToken: config.authToken,
    verbose: false,
  });

  processManager.on('crash', (which: string, count: number) => {
    if (count >= 3) {
      dialog.showErrorBox(
        'MindOS Service Crashed',
        `The ${which} server crashed 3 times. Please check logs and restart.`,
      );
    }
  });

  processManager.on('status-change', (status: string) => {
    updateTrayMenu(currentMode, status as 'starting' | 'running' | 'error', webPort, mcpPort);
  });

  await processManager.start();
  return `http://127.0.0.1:${webPort}`;
}

// ── Remote Mode ──
async function startRemoteMode(): Promise<string | null> {
  // Try saved connection first (auto-reconnect)
  const savedAddress = getActiveRemoteConnection();
  if (savedAddress) {
    try {
      const result = await testConnection(savedAddress);
      if (result.status === 'online') {
        return savedAddress;
      }
    } catch { /* fall through to connect window */ }
  }

  // Show the full connect window
  return showConnectWindow(mainWindow || undefined);
}

// ── IPC Handlers ──
function setupIPC(): void {
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    mode: currentMode,
  }));

  ipcMain.handle('open-mindroot', () => {
    const config = loadConfig();
    const mindRoot = config.mindRoot || path.join(app.getPath('home'), 'MindOS', 'mind');
    shell.openPath(mindRoot);
  });

  ipcMain.handle('switch-mode', async () => {
    const newMode = currentMode === 'local' ? 'remote' : 'local';
    // Cleanup current mode
    if (currentMode === 'local' && processManager) {
      await processManager.stop();
      processManager = null;
    }
    if (currentMode === 'remote' && connectionMonitor) {
      connectionMonitor.stop();
      connectionMonitor = null;
    }

    currentMode = newMode;
    invalidateConfig();

    const url = currentMode === 'local'
      ? await startLocalMode()
      : await startRemoteMode();
    if (url && mainWindow) {
      mainWindow.loadURL(url);
    }
  });
}

// ── App Lifecycle ──
app.whenReady().then(async () => {
  const config = loadConfig();
  currentMode = config.desktopMode || 'local';

  // First run: show mode selection window
  if (!config.desktopMode && !existsSync(CONFIG_PATH)) {
    const selectedMode = await showModeSelection();
    if (selectedMode) {
      currentMode = selectedMode;
      // Save the user's choice
      require('fs').mkdirSync(CONFIG_DIR, { recursive: true });
      require('fs').writeFileSync(CONFIG_PATH, JSON.stringify({ desktopMode: currentMode }, null, 2));
      cachedConfig = { desktopMode: currentMode };
    } else {
      // User cancelled - default to local
      currentMode = 'local';
    }
  }

  mainWindow = createWindow();

  setupIPC();
  createTray(mainWindow);
  const shortcutsOk = registerShortcuts(mainWindow);
  if (!shortcutsOk) {
    console.warn('Failed to register global shortcut CmdOrCtrl+Shift+M (may conflict with another app)');
  }
  setupUpdater();

  let url: string | null = null;

  try {
    if (currentMode === 'local') {
      updateTrayMenu('local', 'starting');
      url = await startLocalMode();
      updateTrayMenu('local', 'running');
    } else {
      url = await startRemoteMode();
      if (url) {
        connectionMonitor = new ConnectionMonitor(url, {
          onLost: () => {
            mainWindow?.webContents.send('connection-lost');
            updateTrayMenu('remote', 'error');
          },
          onRestored: () => {
            mainWindow?.webContents.send('connection-restored');
            mainWindow?.reload();
            updateTrayMenu('remote', 'running');
          },
        });
        connectionMonitor.start();
        updateTrayMenu('remote', 'running');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox('MindOS Startup Error', msg);
    updateTrayMenu(currentMode, 'error');
  }

  if (url) {
    mainWindow.loadURL(url);
  } else {
    mainWindow.loadURL('data:text/html,<h2>Could not connect to MindOS</h2><p>Please restart the application.</p>');
  }
});

// macOS: keep app running when all windows closed
app.on('window-all-closed', () => {
  // Tray keeps the app alive on all platforms
  // On Linux without tray support, user must Quit via other means
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});

// Quit handler — properly await async cleanup before exit
app.on('before-quit', (e) => {
  if (!isQuitting) {
    e.preventDefault();
    isQuitting = true;
    unregisterShortcuts();

    if (mainWindow && !mainWindow.isDestroyed()) {
      saveWindowState(mainWindow);
    }

    const cleanup = async () => {
      if (processManager) await processManager.stop();
      if (connectionMonitor) connectionMonitor.stop();
      app.exit(0);
    };
    cleanup();
  }
});
