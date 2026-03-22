/**
 * Connect Window — local BrowserWindow for remote mode server configuration.
 * Loads connect.html and bridges IPC to shared/connection SDK.
 */
import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { testConnection, normalizeAddress } from '../../shared/connection';
import type { SavedConnection } from '../../shared/connection';

const MAX_CONNECTIONS = 5;

const store = new Store<{
  remoteConnections: SavedConnection[];
  remoteActiveConnection: string | null;
}>({
  name: 'mindos-connections',
  defaults: {
    remoteConnections: [],
    remoteActiveConnection: null,
  },
});

// ── Storage operations ──
function getConnections(): SavedConnection[] {
  return store.get('remoteConnections')
    .sort((a, b) => new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime());
}

function saveConnection(conn: SavedConnection): void {
  let list = store.get('remoteConnections');
  const idx = list.findIndex(c => c.address === conn.address);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...conn };
  } else {
    list.unshift(conn);
  }
  list.sort((a, b) => new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime());
  if (list.length > MAX_CONNECTIONS) list = list.slice(0, MAX_CONNECTIONS);
  store.set('remoteConnections', list);
}

function removeConnection(address: string): void {
  const list = store.get('remoteConnections').filter(c => c.address !== address);
  store.set('remoteConnections', list);
}

export function getActiveRemoteConnection(): string | null {
  return store.get('remoteActiveConnection');
}

export function setActiveRemoteConnection(address: string | null): void {
  store.set('remoteActiveConnection', address);
}

/**
 * Show mode selection window (initial run)
 * Returns 'local' | 'remote' | null
 */
export function showModeSelectWindow(parentWindow?: BrowserWindow): Promise<'local' | 'remote' | null> {
  return new Promise((resolve) => {
    const modeWin = new BrowserWindow({
      width: 480,
      height: 580,
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent: parentWindow || undefined,
      modal: !!parentWindow,
      title: 'MindOS - Mode Selection',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'connect-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
    });

    modeWin.once('ready-to-show', () => modeWin.show());

    // Load same HTML - the page will detect mode selection state
    const htmlPath = path.join(__dirname, '..', 'src', 'connect.html');
    modeWin.loadFile(htmlPath, { query: { modeSelect: 'true' } }).catch(() => {
      // Fallback for packaged app
      modeWin.loadFile(path.join(__dirname, 'connect.html'), { query: { modeSelect: 'true' } });
    });

    let resolved = false;

    // ── IPC Handlers ──

    // Check if Node.js is available
    ipcMain.handle('connect:check-node', () => {
      const { getNodePath } = require('./main');
      return !!getNodePath();
    });

// Check if MindOS CLI is installed
    ipcMain.handle('connect:check-mindos', () => {
      const { execSync } = require('child_process');
      const { getNodePath } = require('./main');
      const nodePath = getNodePath();
      if (!nodePath) return false;

      try {
        // Try to run `mindos --version`
        execSync('mindos --version', { encoding: 'utf-8', timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    });

    // Auto-install MindOS CLI
    ipcMain.handle('connect:install-mindos', async () => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const path = require('path');
      const execAsync = promisify(exec);

      // Get Node.js path and derive npm path
      const { getNodePath } = require('./main');
      const nodePath = getNodePath();

      if (!nodePath) {
        return { success: false, error: 'Node.js not found' };
      }

      // Determine npm path based on node path
      const isWin = process.platform === 'win32';
      const nodeDir = path.dirname(nodePath);
      const npmCmd = isWin
        ? path.join(nodeDir, 'npm.cmd')
        : path.join(nodeDir, '..', 'bin', 'npm');

      // Use the npm from the Node.js installation
      const npmPath = npmCmd;

      try {
        // Use npm to install @geminilight/mindos globally
        const { stdout, stderr } = await execAsync(`"${npmPath}" install -g @geminilight/mindos`, {
          timeout: 120000, // 2 minutes timeout
          encoding: 'utf-8',
        });

        // Verify installation
        try {
          await execAsync('mindos --version', { timeout: 5000 });
          return { success: true, output: stdout || 'Installation completed' };
        } catch {
          return { success: false, error: 'Installation verification failed - mindos command not found in PATH' };
        }
      } catch (err: any) {
        return {
          success: false,
          error: err.message || 'Installation failed',
          stderr: err.stderr,
        };
      }
    });

    ipcMain.handle('connect:select-mode', (_: unknown, mode: 'local' | 'remote') => {
      resolved = true;
      resolve(mode);
      modeWin.close();
      return true;
    });

    ipcMain.handle('connect:show-node-dialog', async () => {
      const { dialog, shell } = require('electron');
      const result = await dialog.showMessageBox(modeWin, {
        type: 'warning',
        title: i18n[detectLang()].nodeRequiredTitle,
        message: i18n[detectLang()].nodeRequiredMessage,
        detail: i18n[detectLang()].nodeRequiredOptions,
        buttons: [
          i18n[detectLang()].downloadNode,
          i18n[detectLang()].switchRemoteBtn,
          i18n[detectLang()].cancel
        ],
        defaultId: 0,
        cancelId: 2,
      });
      if (result.response === 0) return 'install';
      if (result.response === 1) return 'remote';
      return 'cancel';
    });

    ipcMain.handle('connect:open-nodejs', () => {
      const { shell } = require('electron');
      shell.openExternal('https://nodejs.org/');
    });

// Cleanup
    modeWin.on('closed', () => {
      ipcMain.removeHandler('connect:check-node');
      ipcMain.removeHandler('connect:check-mindos');
      ipcMain.removeHandler('connect:install-mindos');
      ipcMain.removeHandler('connect:select-mode');
      ipcMain.removeHandler('connect:show-node-dialog');
      ipcMain.removeHandler('connect:open-nodejs');
      if (!resolved) resolve(null);
    });
  });
}

// Simple i18n helper for Electron dialog
function detectLang(): 'zh' | 'en' {
  const appLocale = require('electron').app.getLocale();
  return appLocale?.startsWith('zh') ? 'zh' : 'en';
}

const i18n = {
  zh: {
    nodeRequiredTitle: '需要 Node.js',
    nodeRequiredMessage: 'Node.js ≥20 是运行本地模式的必需依赖。',
    nodeRequiredOptions: '您可以：\n• 从 nodejs.org 安装（推荐）\n• 切换到远程模式',
    downloadNode: '下载 Node.js',
    switchRemoteBtn: '切换到远程模式',
    cancel: '取消',
  },
  en: {
    nodeRequiredTitle: 'Node.js Required',
    nodeRequiredMessage: 'Node.js ≥20 is required to run MindOS locally.',
    nodeRequiredOptions: 'You can:\n• Install Node.js from nodejs.org (recommended)\n• Switch to Remote mode',
    downloadNode: 'Download Node.js',
    switchRemoteBtn: 'Switch to Remote Mode',
    cancel: 'Cancel',
  }
};

/**
 * Show the connect window and resolve with the authenticated server URL.
 * Returns null if the user cancels or switches to local mode.
 */
export function showConnectWindow(parentWindow?: BrowserWindow): Promise<string | null> {
  return new Promise((resolve) => {
    const connectWin = new BrowserWindow({
      width: 480,
      height: 640,
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent: parentWindow || undefined,
      modal: !!parentWindow,
      title: 'Connect to MindOS',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'connect-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
    });

    connectWin.once('ready-to-show', () => connectWin.show());

    // Load local HTML
    const htmlPath = path.join(__dirname, '..', 'src', 'connect.html');
    connectWin.loadFile(htmlPath).catch(() => {
      // Fallback for packaged app
      connectWin.loadFile(path.join(__dirname, 'connect.html'));
    });

    let resolved = false;

    // ── IPC handlers (scoped to this window) ──
    const handleGetRecent = () => getConnections();

    const handleTestConnection = async (_: unknown, address: string) => {
      return testConnection(address);
    };

    const handleConnect = async (_: unknown, address: string, password: string | null) => {
      const url = normalizeAddress(address);
      if (!url) return { ok: false, error: 'Invalid address' };

      // If password required, attempt auth
      if (password) {
        try {
          const res = await fetch(`${url}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });
          if (!res.ok) return { ok: false, error: 'Incorrect password' };
        } catch (err) {
          return { ok: false, error: `Auth failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      // Save connection
      saveConnection({
        address: url,
        lastConnected: new Date().toISOString(),
        authMethod: password ? 'password' : 'token',
      });
      setActiveRemoteConnection(url);

      resolved = true;
      resolve(url);
      connectWin.close();
      return { ok: true };
    };

    const handleRemoveConnection = (_: unknown, address: string) => {
      removeConnection(address);
    };

    const handleSwitchToLocal = () => {
      resolved = true;
      resolve(null); // null signals "switch to local"
      connectWin.close();
    };

    // Register handlers
    ipcMain.handle('connect:get-recent', handleGetRecent);
    ipcMain.handle('connect:test', handleTestConnection);
    ipcMain.handle('connect:connect', handleConnect);
    ipcMain.handle('connect:remove', handleRemoveConnection);
    ipcMain.handle('connect:switch-local', handleSwitchToLocal);

    // Cleanup on close
    connectWin.on('closed', () => {
      ipcMain.removeHandler('connect:get-recent');
      ipcMain.removeHandler('connect:test');
      ipcMain.removeHandler('connect:connect');
      ipcMain.removeHandler('connect:remove');
      ipcMain.removeHandler('connect:switch-local');
      if (!resolved) resolve(null);
    });
  });
}
