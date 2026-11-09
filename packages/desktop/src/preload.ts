/// <reference lib="dom" />
/**
 * Preload script — exposes safe IPC bridge to renderer.
 * Uses contextBridge for security (contextIsolation: true).
 * All event listeners return cleanup functions to prevent memory leaks.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { exposeConnectBridge } from './connect-bridge';

type CleanupFn = () => void;

function onChannel(channel: string, cb: (...args: unknown[]) => void): CleanupFn {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/**
 * One preload serves three documents, and must expose a different surface to
 * each. A preload is fixed at window creation and cannot be swapped on
 * navigation, so the branch has to happen here:
 *
 *   mindos-connect://…?shell=boot  → boot shell in the main window
 *   mindos-connect://…             → the standalone connect / mode dialogs
 *   anything else                  → the product, on the managed loopback origin
 *
 * The split is the trust boundary. The product origin never receives
 * `mindosConnect` (so a compromised page cannot drive SSH or npm install), and
 * the connect UI never receives `mindos` (so it cannot reach uninstall, core
 * updates, or the Obsidian editor). Both halves of the test matter: the
 * protocol check is what stops a product page from claiming to be the boot
 * shell by navigating to `?shell=boot`, since only our own protocol handler
 * can serve that scheme.
 */
const SURFACE: 'boot' | 'connect' | 'product' = (() => {
  try {
    const url = new URL(window.location.href);
    if (url.protocol !== 'mindos-connect:') return 'product';
    return url.searchParams.get('shell') === 'boot' ? 'boot' : 'connect';
  } catch {
    return 'product';
  }
})();

const IS_BOOT_SHELL = SURFACE !== 'product';

if (SURFACE !== 'product') {
  exposeConnectBridge({ boot: SURFACE === 'boot' });
}

// Mark <html> for macOS-specific CSS (traffic-light safe zone, drag region).
// The inline script in layout.tsx handles this for most loads; this is a belt-and-suspenders fallback.
try {
  if (!IS_BOOT_SHELL && process.platform === 'darwin') {
    window.addEventListener('DOMContentLoaded', () => {
      document.documentElement.setAttribute('data-electron-mac', '');
    });
  }
} catch { /* sandbox may restrict process access */ }

// Shell capability flags — exposed synchronously so the layout.tsx inline head
// script can read them before first paint (spec-titlebar-row).
try {
  if (!IS_BOOT_SHELL) {
    contextBridge.exposeInMainWorld('mindosShell', {
      macTitlebarRow: process.platform === 'darwin',
    });
  }
} catch { /* sandbox may restrict process access */ }

// macOS fullscreen state → html[data-mac-fullscreen]; main resends on every
// did-finish-load because each navigation creates a fresh document.
try {
  if (!IS_BOOT_SHELL && process.platform === 'darwin') {
    onChannel('mindos:mac-fullscreen', (isFullScreen) => {
      if (isFullScreen) document.documentElement.setAttribute('data-mac-fullscreen', '');
      else document.documentElement.removeAttribute('data-mac-fullscreen');
    });
  }
} catch { /* sandbox may restrict process access */ }

if (!IS_BOOT_SHELL) contextBridge.exposeInMainWorld('mindos', {
  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // File system
  openMindRoot: () => ipcRenderer.invoke('open-mindroot'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openObsidianEditor: (pluginId: string, filePath: string) => ipcRenderer.invoke('obsidian:open-editor', { pluginId, filePath }),

  // Mode switching
  switchMode: () => ipcRenderer.invoke('switch-mode'),

  // Updates (Desktop shell — electron-updater)
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Core Hot Update (MindOS Core runtime — independent from shell)
  checkCoreUpdate: () => ipcRenderer.invoke('check-core-update'),
  downloadCoreUpdate: (urls: string[], version: string, size: number, sha256: string) =>
    ipcRenderer.invoke('download-core-update', urls, version, size, sha256),
  cancelCoreDownload: () => ipcRenderer.invoke('cancel-core-download'),
  applyCoreUpdate: () => ipcRenderer.invoke('apply-core-update'),
  getCoreUpdatePending: () => ipcRenderer.invoke('get-core-update-pending'),

  // Uninstall (Desktop self-deletion)
  uninstallApp: () => ipcRenderer.invoke('uninstall-app'),

  // Event listeners (return cleanup function)
  onUpdateAvailable: (cb: (info: unknown) => void): CleanupFn => onChannel('update-available', cb),
  onUpdateProgress: (cb: (progress: unknown) => void): CleanupFn => onChannel('update-progress', cb),
  onUpdateReady: (cb: () => void): CleanupFn => onChannel('update-ready', cb),
  onUpdateInstalling: (cb: () => void): CleanupFn => onChannel('update-installing', cb),
  onUpdateError: (cb: (info: unknown) => void): CleanupFn => onChannel('update-error', cb),
  onCoreUpdateProgress: (cb: (progress: unknown) => void): CleanupFn => onChannel('core-update-progress', cb),
  onCoreUpdateAvailable: (cb: (info: unknown) => void): CleanupFn => onChannel('core-update-available', cb),
  onServerStatus: (cb: (status: string) => void): CleanupFn => onChannel('server-status', cb as (...args: unknown[]) => void),
  onConnectionLost: (cb: () => void): CleanupFn => onChannel('connection-lost', cb),
  onConnectionRestored: (cb: () => void): CleanupFn => onChannel('connection-restored', cb),
});
