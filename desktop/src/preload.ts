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

  // Mode switching
  switchMode: () => ipcRenderer.invoke('switch-mode'),

  // Updates
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Uninstall (Desktop self-deletion)
  uninstallApp: () => ipcRenderer.invoke('uninstall-app'),

  // Event listeners (return cleanup function)
  onUpdateAvailable: (cb: (info: unknown) => void): CleanupFn => onChannel('update-available', cb),
  onUpdateProgress: (cb: (progress: unknown) => void): CleanupFn => onChannel('update-progress', cb),
  onUpdateReady: (cb: () => void): CleanupFn => onChannel('update-ready', cb),
  onServerStatus: (cb: (status: string) => void): CleanupFn => onChannel('server-status', cb as (...args: unknown[]) => void),
  onConnectionLost: (cb: () => void): CleanupFn => onChannel('connection-lost', cb),
  onConnectionRestored: (cb: () => void): CleanupFn => onChannel('connection-restored', cb),
});
