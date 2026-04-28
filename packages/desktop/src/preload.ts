/// <reference lib="dom" />
/**
 * Preload script — exposes safe IPC bridge to renderer.
 * Uses contextBridge for security (contextIsolation: true).
 * All event listeners return cleanup functions to prevent memory leaks.
 */
import { contextBridge, ipcRenderer } from 'electron';

type CleanupFn = () => void;

function onChannel(channel: string, cb: (...args: unknown[]) => void): CleanupFn {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Mark <html> for macOS-specific CSS (traffic-light safe zone, drag region).
// The inline script in layout.tsx handles this for most loads; this is a belt-and-suspenders fallback.
try {
  if (process.platform === 'darwin') {
    window.addEventListener('DOMContentLoaded', () => {
      document.documentElement.setAttribute('data-electron-mac', '');
    });
  }
} catch { /* sandbox may restrict process access */ }

contextBridge.exposeInMainWorld('mindos', {
  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // File system
  openMindRoot: () => ipcRenderer.invoke('open-mindroot'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

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
  onUpdateError: (cb: (info: unknown) => void): CleanupFn => onChannel('update-error', cb),
  onCoreUpdateProgress: (cb: (progress: unknown) => void): CleanupFn => onChannel('core-update-progress', cb),
  onCoreUpdateAvailable: (cb: (info: unknown) => void): CleanupFn => onChannel('core-update-available', cb),
  onServerStatus: (cb: (status: string) => void): CleanupFn => onChannel('server-status', cb as (...args: unknown[]) => void),
  onConnectionLost: (cb: () => void): CleanupFn => onChannel('connection-lost', cb),
  onConnectionRestored: (cb: () => void): CleanupFn => onChannel('connection-restored', cb),
});
