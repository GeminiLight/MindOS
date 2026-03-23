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

// ── IPC handlers registration helpers ──

function safeHandle(channel: string, handler: (...args: any[]) => any): void {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // Channel might not exist yet, ignore
  }
  ipcMain.handle(channel, handler);
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

    safeHandle('connect:check-node', () => {
      const { getNodePath } = require('./main');
      return !!getNodePath();
    });

    safeHandle('connect:check-mindos-status', () => {
      const userMindos = getUserMindosPath();

      if (!userMindos) {
        return { status: 'not-installed', path: null };
      }

      return {
        status: userMindos.isBuilt ? 'ready' : 'installed-not-built',
        path: userMindos.modulePath,
      };
    });

    safeHandle('connect:build-mindos', async (_: unknown, modulePath: string) => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const fs = require('fs');
      const path = require('path');
      const execAsync = promisify(exec);

      try {
        // Check if already built (standalone server or .next dir)
        const standaloneServer = path.join(modulePath, 'app', '.next', 'standalone', 'server.js');
        const nextDir = path.join(modulePath, 'app', '.next');
        if (fs.existsSync(standaloneServer) || fs.existsSync(nextDir)) {
          return { success: true, output: 'Already built' };
        }

        // Run npm install + build in the module directory
        const { stdout, stderr } = await execAsync(
          'npm install && npm run build',
          { cwd: modulePath, timeout: 300000, encoding: 'utf-8' }
        );

        if (fs.existsSync(nextDir)) {
          return { success: true, output: stdout || 'Build completed' };
        } else {
          return { success: false, error: 'Build completed but app/.next not found', stderr };
        }
      } catch (err: any) {
        return {
          success: false,
          error: err.message || 'Build failed',
          stderr: err.stderr,
        };
      }
    });

    safeHandle('connect:get-mindos-path', () => {
      const userMindos = getUserMindosPath();
      if (userMindos?.isBuilt) {
        return { path: userMindos.modulePath, source: 'user' };
      }
      return null;
    });

    safeHandle('connect:select-mode', (_: unknown, mode: 'local' | 'remote') => {
      resolved = true;
      resolve(mode);
      modeWin.close();
      return true;
    });

    safeHandle('connect:show-node-dialog', async () => {
      const { dialog } = require('electron');
      const result = await dialog.showMessageBox(modeWin as BrowserWindow, {
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

    safeHandle('connect:open-nodejs', () => {
      const { shell } = require('electron');
      shell.openExternal('https://nodejs.org/');
    });

    // Auto-install MindOS CLI
    safeHandle('connect:install-mindos', async () => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      try {
        // Install @geminilight/mindos globally
        const { stdout, stderr } = await execAsync(
          'npm install -g @geminilight/mindos@latest',
          { timeout: 300000, encoding: 'utf-8' }
        );

        // Verify installation
        const userMindos = getUserMindosPath();
        if (userMindos) {
          return { success: true };
        } else {
          return {
            success: false,
            error: 'Installation may have succeeded but could not be verified. Please restart Desktop.',
            stderr
          };
        }
      } catch (err: any) {
        return {
          success: false,
          error: err.message || 'Installation failed',
          stderr: err.stderr
        };
      }
    });

    // Cleanup
    modeWin.on('closed', () => {
      ['connect:check-node', 'connect:check-mindos-status', 'connect:build-mindos',
       'connect:get-mindos-path', 'connect:install-mindos', 'connect:select-mode',
       'connect:show-node-dialog', 'connect:open-nodejs'].forEach(ch => {
        try { ipcMain.removeHandler(ch); } catch { /* ignore */ }
      });
      if (!resolved) resolve(null);
    });
  });
}

// ── MindOS detection utilities ──

/**
 * Detect user local MindOS installation
 * Returns module path and build status
 */
function getUserMindosPath(): { modulePath: string; isBuilt: boolean } | null {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    const modulePath = path.join(globalRoot, '@geminilight', 'mindos');

    if (!fs.existsSync(modulePath)) return null;

    // Build is complete when app/.next exists (standalone or standard)
    const nextDir = path.join(modulePath, 'app', '.next');
    const isBuilt = fs.existsSync(nextDir);

    return { modulePath, isBuilt };
  } catch {
    return null;
  }
}

// Simple i18n helper for Electron dialog
function detectLang(): 'zh' | 'en' {
  const appLocale = require('electron').app.getLocale();
  return appLocale?.startsWith('zh') ? 'zh' : 'en';
}

const i18n = {
  zh: {
    nodeRequiredTitle: '需要 Node.js',
    nodeRequiredMessage: 'Node.js ≥18 是运行本地模式的必需依赖。',
    nodeRequiredOptions: '您可以：\n• 从 nodejs.org 安装（推荐）\n• 切换到远程模式',
    downloadNode: '下载 Node.js',
    switchRemoteBtn: '切换到远程模式',
    cancel: '取消',
  },
  en: {
    nodeRequiredTitle: 'Node.js Required',
    nodeRequiredMessage: 'Node.js ≥18 is required to run MindOS locally.',
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
    safeHandle('connect:get-recent', () => getConnections());

    safeHandle('connect:test', async (_: unknown, address: string) => {
      return testConnection(address);
    });

    safeHandle('connect:connect', async (_: unknown, address: string, password: string | null) => {
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
    });

    safeHandle('connect:remove', (_: unknown, address: string) => {
      removeConnection(address);
    });

    safeHandle('connect:switch-local', () => {
      resolved = true;
      resolve(null); // null signals "switch to local"
      connectWin.close();
    });

    // Cleanup on close
    connectWin.on('closed', () => {
      ['connect:get-recent', 'connect:test', 'connect:connect', 'connect:remove', 'connect:switch-local']
      .forEach(ch => {
        try { ipcMain.removeHandler(ch); } catch { /* ignore */ }
      });
      if (!resolved) resolve(null);
    });
  });
}
