/**
 * Auto-updater — checks GitHub Releases for updates.
 * Uses electron-updater with non-intrusive notifications.
 */
import { autoUpdater } from 'electron-updater';
import { ipcMain, BrowserWindow, app, dialog } from 'electron';

export function setupUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on('update-available', (info) => {
    // Only notify if version is actually newer than current
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
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      win.webContents.send('update-ready');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
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
    try {
      await autoUpdater.downloadUpdate();
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      dialog.showErrorBox('Update Error', `Failed to install update: ${err}`);
    }
  });

  // Silent check on startup (after 10s delay)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10_000);
}
