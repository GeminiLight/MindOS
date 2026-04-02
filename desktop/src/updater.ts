/**
 * Auto-updater — checks GitHub Releases for updates.
 * Uses electron-updater with non-intrusive notifications.
 */
import { autoUpdater } from 'electron-updater';
import { ipcMain, BrowserWindow, app, dialog } from 'electron';

export interface UpdaterOptions {
  /** Called right before quitAndInstall so main can skip its cleanup handler */
  onBeforeQuitAndInstall?: () => void;
}

export function setupUpdater(opts?: UpdaterOptions): () => void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;

  let isDownloaded = false;

  autoUpdater.on('update-available', (info) => {
    if (info.version === app.getVersion()) return;

    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      win.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      win.webContents.send('update-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    isDownloaded = true;
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      win.webContents.send('update-ready');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
    // Notify renderer so UI can show error instead of stuck progress
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      win.webContents.send('update-error', { message: err.message });
    }
  });

  // IPC handlers
  ipcMain.handle('check-update', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const updateVersion = result?.updateInfo?.version;
      const available = !!updateVersion && updateVersion !== app.getVersion();
      return { available, version: updateVersion };
    } catch {
      return { available: false };
    }
  });

  ipcMain.handle('install-update', async () => {
    if (!isDownloaded) {
      await autoUpdater.downloadUpdate();
    }
    // Signal main process to skip cleanup — let the installer relaunch
    opts?.onBeforeQuitAndInstall?.();
    autoUpdater.quitAndInstall(false, true);
  });

  // Silent check on startup (after 10s delay), then every 12 hours
  const startupCheck = setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[MindOS:updater] Startup check failed:', err?.message);
    });
  }, 10_000);
  const periodicCheck = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[MindOS:updater] Periodic check failed:', err?.message);
    });
  }, 12 * 60 * 60 * 1000);

  // Return cleanup function
  return () => {
    clearTimeout(startupCheck);
    clearInterval(periodicCheck);
  };
}
