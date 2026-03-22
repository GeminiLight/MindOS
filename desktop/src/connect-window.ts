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
        preload: path.join(__dirname, 'connect-preload.js'),
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
