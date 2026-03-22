/**
 * Preload for connect window — bridges IPC for connection flow.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mindosConnect', {
  // Mode selection
  checkNode: () => ipcRenderer.invoke('connect:check-node'),
  checkMindos: () => ipcRenderer.invoke('connect:check-mindos'),
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
