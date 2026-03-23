/**
 * Connect Window — local BrowserWindow for remote mode server configuration.
 * Loads connect.html and bridges IPC to shared/connection SDK.
 */
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { testConnection, normalizeAddress } from '../../shared/connection';
import type { SavedConnection } from '../../shared/connection';
import { getNodePath, getMindosInstallPath, getEnrichedEnv } from './node-detect';
import { parseSshConfig, isSshAvailable, SshTunnel } from './ssh-tunnel';
import { findAvailablePort } from './port-finder';

// Active SSH tunnel (shared across windows)
let activeTunnel: SshTunnel | null = null;

export function getActiveTunnel(): SshTunnel | null { return activeTunnel; }
export function clearActiveTunnel(): void {
  if (activeTunnel) { activeTunnel.stop().catch(() => {}); activeTunnel = null; }
}

/**
 * Resolve paths relative to the app root.
 * - Dev: app.getAppPath() → desktop/ (where package.json lives)
 * - Production: app.getAppPath() → <resources>/app.asar
 * Both have src/connect.html and dist-electron/ at root level.
 */
const APP_ROOT = app.getAppPath();
const HTML_PATH = path.join(APP_ROOT, 'src', 'connect.html');
const PRELOAD_PATH = path.join(APP_ROOT, 'dist-electron', 'preload', 'connect-preload.js');

const MAX_CONNECTIONS = 5;

const store = new Store<{
  remoteConnections: SavedConnection[];
  remoteActiveConnection: string | null;
  /** Encrypted passwords keyed by server address */
  encryptedPasswords: Record<string, string>;
}>({
  name: 'mindos-connections',
  defaults: {
    remoteConnections: [],
    remoteActiveConnection: null,
    encryptedPasswords: {},
  },
});

// ── Password encryption ──

function savePassword(address: string, password: string): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const encrypted = safeStorage.encryptString(password).toString('base64');
    const passwords = store.get('encryptedPasswords');
    passwords[address] = encrypted;
    store.set('encryptedPasswords', passwords);
  } catch { /* encryption not available */ }
}

export function loadPassword(address: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const passwords = store.get('encryptedPasswords');
    const encrypted = passwords[address];
    if (!encrypted) return null;
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch { return null; }
}

function removePassword(address: string): void {
  try {
    const passwords = store.get('encryptedPasswords');
    delete passwords[address];
    store.set('encryptedPasswords', passwords);
  } catch { /* ignore */ }
}

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
      // Independent window — not modal, not parented.
      // Modal + hidden titlebar on parent = dead lock on macOS.
      title: 'MindOS',
      titleBarStyle: 'default',
      webPreferences: {
        preload: PRELOAD_PATH,
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
    });

    modeWin.once('ready-to-show', () => modeWin.show());

    modeWin.loadFile(HTML_PATH, { query: { modeSelect: 'true' } }).catch(err => {
      console.error('[MindOS] Failed to load connect.html for mode selection:', err);
    });

    let resolved = false;

    // ── IPC Handlers ──

    safeHandle('connect:check-node', async () => {
      return !!(await getNodePath());
    });

    safeHandle('connect:check-mindos-status', async () => {
      // First find node so we can use its bin dir for npm
      const nodePath = await getNodePath();
      const mindosPath = await getMindosInstallPath(nodePath);

      if (!mindosPath) {
        return { status: 'not-installed', path: null };
      }

      // Check build status
      const fs = require('fs');
      const p = require('path');
      const nextDir = p.join(mindosPath, 'app', '.next');
      const isBuilt = fs.existsSync(nextDir);

      return {
        status: isBuilt ? 'ready' : 'installed-not-built',
        path: mindosPath,
      };
    });

    safeHandle('connect:build-mindos', async (_: unknown, modulePath: string) => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const fs = require('fs');
      const pathMod = require('path');
      const execBuild = promisify(exec);

      try {
        const standaloneServer = pathMod.join(modulePath, 'app', '.next', 'standalone', 'server.js');
        const nextDir = pathMod.join(modulePath, 'app', '.next');
        if (fs.existsSync(standaloneServer) || fs.existsSync(nextDir)) {
          return { success: true, output: 'Already built' };
        }

        const nodePath = await getNodePath();
        const enrichedEnv = getEnrichedEnv(nodePath);

        const { stdout, stderr } = await execBuild(
          'npm install && npm run build',
          { cwd: modulePath, timeout: 300000, encoding: 'utf-8', env: enrichedEnv }
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

    safeHandle('connect:get-mindos-path', async () => {
      const nodePath = await getNodePath();
      const mindosPath = await getMindosInstallPath(nodePath);
      if (mindosPath) {
        const fs = require('fs');
        const p = require('path');
        const nextDir = p.join(mindosPath, 'app', '.next');
        if (fs.existsSync(nextDir)) {
          return { path: mindosPath, source: 'user' };
        }
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
      const execInstall = promisify(exec);

      try {
        const nodePath = await getNodePath();
        const enrichedEnv = getEnrichedEnv(nodePath);

        const { stdout, stderr } = await execInstall(
          'npm install -g @geminilight/mindos@latest',
          { timeout: 300000, encoding: 'utf-8', env: enrichedEnv }
        );

        // Verify installation
        const mindosPath = await getMindosInstallPath(nodePath);
        if (mindosPath) {
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
      title: 'MindOS',
      titleBarStyle: 'default',
      webPreferences: {
        preload: PRELOAD_PATH,
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
    });

    connectWin.once('ready-to-show', () => connectWin.show());

    connectWin.loadFile(HTML_PATH).catch(err => {
      console.error('[MindOS] Failed to load connect.html for remote connection:', err);
    });

    let resolved = false;

    // ── IPC handlers (scoped to this window) ──
    safeHandle('connect:get-recent', () => {
      // Include saved password availability info
      const connections = getConnections();
      return connections.map(c => ({
        ...c,
        hasPassword: !!loadPassword(c.address),
      }));
    });

    safeHandle('connect:get-saved-password', (_: unknown, address: string) => {
      return loadPassword(address);
    });

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

      // Save connection + encrypted password
      saveConnection({
        address: url,
        lastConnected: new Date().toISOString(),
        authMethod: password ? 'password' : 'token',
      });
      if (password) savePassword(url, password);
      setActiveRemoteConnection(url);

      resolved = true;
      resolve(url);
      connectWin.close();
      return { ok: true };
    });

    safeHandle('connect:remove', (_: unknown, address: string) => {
      removeConnection(address);
      removePassword(address);
    });

    safeHandle('connect:switch-local', () => {
      resolved = true;
      resolve(null);
      connectWin.close();
    });

    // ── SSH tunnel handlers ──

    safeHandle('connect:ssh-hosts', async () => {
      const available = await isSshAvailable();
      if (!available) return { available: false, hosts: [] };
      const hosts = parseSshConfig();
      return { available: true, hosts };
    });

    safeHandle('connect:ssh-connect', async (_: unknown, host: string, remotePort: number) => {
      try {
        // Clean up any existing tunnel
        if (activeTunnel) { await activeTunnel.stop(); activeTunnel = null; }

        const localPort = await findAvailablePort(remotePort);
        const tunnel = new SshTunnel(host, localPort, remotePort);
        await tunnel.start();
        activeTunnel = tunnel;

        // Test that MindOS is actually running on the other end
        const result = await testConnection(`http://localhost:${localPort}`);
        if (result.status !== 'online') {
          await tunnel.stop();
          activeTunnel = null;
          return { ok: false, error: result.status === 'not-mindos' ? 'Server is reachable but MindOS is not running' : 'Cannot reach MindOS through tunnel' };
        }

        // Save as active connection
        const url = `http://localhost:${localPort}`;
        saveConnection({
          address: `ssh://${host}:${remotePort}`,
          label: `${host} (SSH)`,
          lastConnected: new Date().toISOString(),
          authMethod: 'token',
        });
        setActiveRemoteConnection(url);

        resolved = true;
        resolve(url);
        connectWin.close();
        return { ok: true, url, authRequired: result.authRequired };
      } catch (err: any) {
        return { ok: false, error: err.message || 'SSH tunnel failed' };
      }
    });

    // Cleanup on close
    connectWin.on('closed', () => {
      ['connect:get-recent', 'connect:get-saved-password', 'connect:test', 'connect:connect',
       'connect:remove', 'connect:switch-local', 'connect:ssh-hosts', 'connect:ssh-connect']
      .forEach(ch => {
        try { ipcMain.removeHandler(ch); } catch { /* ignore */ }
      });
      if (!resolved) resolve(null);
    });
  });
}
