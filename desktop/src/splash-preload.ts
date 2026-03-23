/**
 * Preload for splash screen — minimal IPC for status updates.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mindosSplash', {
  onStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('splash:status', (_event, data) => callback(data));
  },
  action: (id: string) => ipcRenderer.invoke('splash:action', id),
});
