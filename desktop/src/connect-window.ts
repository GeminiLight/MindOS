/**
 * Connect Window — local BrowserWindow for remote mode server configuration.
 * Loads connect.html and bridges IPC to shared/connection SDK.
 */
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { resolvePreferUnpacked } from './resolve-packaged-asset';
import { mindosConnectPageUrl } from './mindos-connect-protocol';
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

function connectPreloadPath(): string {
  return resolvePreferUnpacked('dist-electron', 'preload', 'connect-preload.js');
}

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
 * Register SSH tunnel + remote connection IPC handlers.
 * Shared between showModeSelectWindow and showConnectWindow
 * because both can display the remote connection screen.
 */
function registerSshHandlers(
  resolvedRef: { value: boolean },
  resolve: (url: string | null) => void,
  win: { close: () => void },
): void {
  safeHandle('connect:get-recent', () => {
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

    if (password) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`${url}/api/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) return { ok: false, error: 'Incorrect password' };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: 'Auth request timed out' };
        }
        return { ok: false, error: `Auth failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    saveConnection({
      address: url,
      lastConnected: new Date().toISOString(),
      authMethod: password ? 'password' : 'token',
    });
    if (password) savePassword(url, password);
    setActiveRemoteConnection(url);

    resolvedRef.value = true;
    resolve(url);
    win.close();
    return { ok: true };
  });

  safeHandle('connect:remove', (_: unknown, address: string) => {
    removeConnection(address);
    removePassword(address);
  });

  safeHandle('connect:switch-local', () => {
    resolvedRef.value = true;
    resolve(null);
    win.close();
  });

  safeHandle('connect:ssh-hosts', async () => {
    const available = await isSshAvailable();
    if (!available) return { available: false, hosts: [] };
    const hosts = parseSshConfig();
    return { available: true, hosts };
  });

  safeHandle('connect:ssh-connect', async (_: unknown, host: string, remotePort: number) => {
    try {
      if (activeTunnel) { await activeTunnel.stop(); activeTunnel = null; }

      // Retry up to 3 times to handle transient failures and port collisions
      let lastError = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const localPort = await findAvailablePort(remotePort + attempt);
          const tunnel = new SshTunnel(host, localPort, remotePort);
          await tunnel.start();
          activeTunnel = tunnel;

          const result = await testConnection(`http://localhost:${localPort}`);
          if (result.status === 'online') {
            // Success path continues below the retry loop
            const url = `http://localhost:${localPort}`;
            saveConnection({
              address: `ssh://${host}:${remotePort}`,
              label: `${host} (SSH)`,
              lastConnected: new Date().toISOString(),
              authMethod: 'token',
            });
            setActiveRemoteConnection(url);
            resolvedRef.value = true;
            resolve(url);
            win.close();
            return { ok: true, url, authRequired: result.authRequired };
          }

          // MindOS not running on remote
          await tunnel.stop();
          activeTunnel = null;
          return { ok: false, error: result.status === 'not-mindos' ? 'Server is reachable but MindOS is not running' : 'Cannot reach MindOS through tunnel' };
        } catch (retryErr: any) {
          lastError = retryErr.message || 'SSH tunnel failed';
          if (activeTunnel) { await activeTunnel.stop().catch(() => {}); activeTunnel = null; }
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      return { ok: false, error: lastError };

    } catch (err: any) {
      return { ok: false, error: err.message || 'SSH tunnel failed' };
    }
  });
}

/** Channels registered by registerSshHandlers — for cleanup */
const REMOTE_CHANNELS = [
  'connect:get-recent', 'connect:get-saved-password', 'connect:test', 'connect:connect',
  'connect:remove', 'connect:switch-local', 'connect:ssh-hosts', 'connect:ssh-connect',
];

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
        preload: connectPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
        /** Default sandbox breaks file/custom-scheme loading from the app bundle on macOS. */
        sandbox: false,
      },
      show: false,
    });

    modeWin.once('ready-to-show', () => modeWin.show());

    modeWin.loadURL(mindosConnectPageUrl({ modeSelect: 'true' })).catch(err => {
      console.error('[MindOS] Failed to load connect.html for mode selection:', err);
    });

    const resolvedRef = { value: false };

    // ── IPC Handlers ──

    safeHandle('connect:check-node', async () => {
      // Packaged app bundles Node.js; if bundled node is missing,
      // checkMindosStatus will report bundled-incomplete (the real problem).
      if (app.isPackaged) return true;
      return !!(await getNodePath());
    });

    safeHandle('connect:check-mindos-status', async () => {
      // Check bundled runtime first (Desktop ships with mindos-runtime/)
      try {
        const { getDefaultBundledMindOsDirectory } = await import('./mindos-runtime-path');
        const { analyzeMindOsLayout } = await import('./mindos-runtime-layout');
        const bundledDir = getDefaultBundledMindOsDirectory();

        if (bundledDir && existsSync(bundledDir)) {
          const analysis = analyzeMindOsLayout(bundledDir);
          if (analysis.runnable) {
            return { status: 'ready', path: bundledDir };
          }

          // Not runnable — in dev mode, source dirs can be built in place
          if (!app.isPackaged) {
            const hasAppSrc = existsSync(path.join(bundledDir, 'app'));
            const hasMcpSrc = existsSync(path.join(bundledDir, 'mcp'));
            if (hasAppSrc && hasMcpSrc) {
              return { status: 'installed-not-built', path: bundledDir };
            }
          }
        }

        // Packaged app: resources are read-only, user must reinstall
        if (app.isPackaged) {
          return { status: 'bundled-incomplete', path: bundledDir ?? null };
        }
      } catch (err) {
        console.error('[MindOS] Bundled runtime check failed:', err);
        if (app.isPackaged) {
          return { status: 'bundled-incomplete', path: null };
        }
      }

      // Fallback: check npm global install (dev/standalone mode only)
      const nodePath = await getNodePath();
      const mindosPath = await getMindosInstallPath(nodePath);

      if (!mindosPath) {
        return { status: 'not-installed', path: null };
      }

      const nextDir = path.join(mindosPath, 'app', '.next');
      const isBuilt = existsSync(nextDir);

      return {
        status: isBuilt ? 'ready' : 'installed-not-built',
        path: mindosPath,
      };
    });

    safeHandle('connect:build-mindos', async (_: unknown, modulePath: string) => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execBuild = promisify(exec);

      try {
        const standaloneServer = path.join(modulePath, 'app', '.next', 'standalone', 'server.js');
        const nextDir = path.join(modulePath, 'app', '.next');
        if (existsSync(standaloneServer) || existsSync(nextDir)) {
          return { success: true, output: 'Already built' };
        }

        const nodePath = await getNodePath();
        const enrichedEnv = getEnrichedEnv(nodePath);

        const { stdout, stderr } = await execBuild(
          'npm install && npm run build',
          { cwd: modulePath, timeout: 300000, encoding: 'utf-8', env: enrichedEnv }
        );

        if (existsSync(nextDir)) {
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
      // Check bundled runtime first
      try {
        const { getDefaultBundledMindOsDirectory } = await import('./mindos-runtime-path');
        const { analyzeMindOsLayout } = await import('./mindos-runtime-layout');
        const bundledDir = getDefaultBundledMindOsDirectory();
        if (bundledDir && existsSync(bundledDir)) {
          const analysis = analyzeMindOsLayout(bundledDir);
          if (analysis.runnable) {
            return { path: bundledDir, source: 'bundled' as const };
          }
        }
      } catch { /* fall through */ }

      // In packaged mode, bundled is the only path
      if (app.isPackaged) return null;

      // Fallback: npm global install (dev mode only)
      const nodePath = await getNodePath();
      const mindosPath = await getMindosInstallPath(nodePath);
      if (mindosPath) {
        const nextDir = path.join(mindosPath, 'app', '.next');
        if (existsSync(nextDir)) {
          return { path: mindosPath, source: 'user' as const };
        }
      }
      return null;
    });

    safeHandle('connect:select-mode', (_: unknown, mode: 'local' | 'remote') => {
      resolvedRef.value = true;
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

    // ── SSH handlers (needed when user switches to remote screen within mode selection) ──
    registerSshHandlers(resolvedRef, resolve as (v: string | null) => void, { close: () => modeWin.close() });

    // Cleanup
    modeWin.on('closed', () => {
      ['connect:check-node', 'connect:check-mindos-status', 'connect:build-mindos',
       'connect:get-mindos-path', 'connect:install-mindos', 'connect:select-mode',
       'connect:show-node-dialog', 'connect:open-nodejs',
       ...REMOTE_CHANNELS].forEach(ch => {
        try { ipcMain.removeHandler(ch); } catch { /* ignore */ }
      });
      if (!resolvedRef.value) resolve(null);
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
        preload: connectPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
      show: false,
    });

    connectWin.once('ready-to-show', () => connectWin.show());

    connectWin.loadURL(mindosConnectPageUrl()).catch(err => {
      console.error('[MindOS] Failed to load connect.html for remote connection:', err);
    });

    const resolvedRef = { value: false };

    // Register all remote connection handlers (shared with mode select window)
    registerSshHandlers(resolvedRef, resolve, { close: () => connectWin.close() });

    // Cleanup on close
    connectWin.on('closed', () => {
      REMOTE_CHANNELS.forEach(ch => {
        try { ipcMain.removeHandler(ch); } catch { /* ignore */ }
      });
      if (!resolvedRef.value) resolve(null);
    });
  });
}
