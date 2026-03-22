/**
 * Preload for connect window — bridges IPC for connection flow.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mindosConnect', {
  getRecentConnections: () => ipcRenderer.invoke('connect:get-recent'),
  testConnection: (address: string) => ipcRenderer.invoke('connect:test', address),
  connect: (address: string, password: string | null) => ipcRenderer.invoke('connect:connect', address, password),
  removeConnection: (address: string) => ipcRenderer.invoke('connect:remove', address),
  switchToLocal: () => ipcRenderer.invoke('connect:switch-local'),
});
