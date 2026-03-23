/**
 * Preload for connect window — bridges IPC for connection flow.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mindosConnect', {
  // Mode selection
  checkNode: () => ipcRenderer.invoke('connect:check-node'),
  checkMindosStatus: () => ipcRenderer.invoke('connect:check-mindos-status'),
  buildMindos: (modulePath: string) => ipcRenderer.invoke('connect:build-mindos', modulePath),
  getMindosPath: () => ipcRenderer.invoke('connect:get-mindos-path'),
  installMindos: () => ipcRenderer.invoke('connect:install-mindos'),
  selectMode: (mode: 'local' | 'remote') => ipcRenderer.invoke('connect:select-mode', mode),
  showNodeDialog: () => ipcRenderer.invoke('connect:show-node-dialog'),
  openNodejs: () => ipcRenderer.invoke('connect:open-nodejs'),

  // Connection management
  getRecentConnections: () => ipcRenderer.invoke('connect:get-recent'),
  testConnection: (address: string) => ipcRenderer.invoke('connect:test', address),
  connect: (address: string, password: string | null) => ipcRenderer.invoke('connect:connect', address, password),
  removeConnection: (address: string) => ipcRenderer.invoke('connect:remove', address),
  switchToLocal: () => ipcRenderer.invoke('connect:switch-local'),
});
