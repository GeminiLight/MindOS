/**
 * Auto-updater — checks GitHub Releases for updates.
 * Uses electron-updater with non-intrusive notifications.
 */
import { autoUpdater } from 'electron-updater';
import { ipcMain, BrowserWindow, app, type IpcMainInvokeEvent } from 'electron';
import semver from 'semver';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

const MANUAL_DESKTOP_UPDATE_URL = 'https://github.com/GeminiLight/MindOS/releases/latest';
export const UPDATE_INSTALL_STALL_TIMEOUT_MS = 45_000;

export interface ShellUpdateSupport {
  canInstall: boolean;
  reason?: string;
  manualUrl?: string;
}

interface InstallUpdateResult {
  ok: boolean;
  phase?: 'installing';
  error?: string;
  manualUrl?: string;
}

interface ShellUpdateSupportOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  existsSync?: (file: string) => boolean;
  readFileSync?: (file: string, encoding: BufferEncoding) => string;
}

function readLinuxPackageType(opts: Required<Pick<ShellUpdateSupportOptions, 'resourcesPath' | 'existsSync' | 'readFileSync'>>): string | null {
  const packageTypePath = path.join(opts.resourcesPath, 'package-type');
  if (!opts.existsSync(packageTypePath)) return null;
  try {
    return opts.readFileSync(packageTypePath, 'utf-8').trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * electron-updater can check Linux package feeds for several package types, but
 * applying deb/rpm/pacman updates requires system package-manager elevation and
 * can block or fail without a GUI auth agent. Treat those installs as manual so
 * the UI never promises a one-click restart that the current process cannot
 * reliably complete.
 */
export function getShellUpdateSupport(options: ShellUpdateSupportOptions = {}): ShellUpdateSupport {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') return { canInstall: true };
  const env = options.env ?? process.env;

  const resourcesPath = options.resourcesPath ?? process.resourcesPath ?? '';
  const packageType = resourcesPath
    ? readLinuxPackageType({
        resourcesPath,
        existsSync: options.existsSync ?? existsSync,
        readFileSync: options.readFileSync ?? readFileSync,
      })
    : null;

  if (packageType === 'deb') {
    return {
      canInstall: false,
      reason: 'Debian/Ubuntu package updates must be installed by downloading the latest .deb package.',
      manualUrl: MANUAL_DESKTOP_UPDATE_URL,
    };
  }
  if (packageType === 'rpm' || packageType === 'pacman') {
    return {
      canInstall: false,
      reason: `${packageType} package updates must be installed with the system package manager.`,
      manualUrl: MANUAL_DESKTOP_UPDATE_URL,
    };
  }
  if (!env.APPIMAGE) {
    return {
      canInstall: false,
      reason: 'This Linux install type cannot be updated in place. Download the latest Desktop build.',
      manualUrl: MANUAL_DESKTOP_UPDATE_URL,
    };
  }
  return { canInstall: true };
}

/**
 * Decide whether a feed version is a real upgrade over the running version.
 * A plain string-inequality check would treat a DOWNGRADE (user running a
 * version newer than the feed, e.g. after a rollback) as an available update,
 * producing a permanent update prompt and a failing download loop.
 */
export function isUpdateAvailable(
  updateVersion: string | undefined,
  currentVersion: string,
  electronUpdaterFlag?: boolean,
): boolean {
  if (!updateVersion) return false;
  if (electronUpdaterFlag === false) return false;
  if (semver.valid(updateVersion) && semver.valid(currentVersion)) {
    return semver.gt(updateVersion, currentVersion);
  }
  // Versions not comparable — only trust electron-updater's own judgment,
  // never claim an update just because the strings differ.
  return electronUpdaterFlag === true;
}

export interface UpdaterOptions {
  /** Called right before quitAndInstall so main can skip its cleanup handler */
  onBeforeQuitAndInstall?: () => void;
  /** Called if quitAndInstall fails or the app remains alive after starting it. */
  onInstallFailed?: () => void;
  /** Trusted-side IPC guard supplied by main.ts. */
  assertTrustedLocalRenderer?: (event: IpcMainInvokeEvent, capability: string) => void;
  /** Test hook: override host-platform support detection. */
  updateSupport?: ShellUpdateSupport;
}

export function setupUpdater(opts?: UpdaterOptions): () => void {
  const support = opts?.updateSupport ?? getShellUpdateSupport();
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    autoUpdater.channel = 'latest-arm64';
  } else if (process.platform === 'win32' && process.arch === 'arm64') {
    autoUpdater.channel = 'latest-arm64';
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;

  let isDownloaded = false;
  let installInProgress = false;
  let activeInstallRequest: Promise<InstallUpdateResult> | null = null;
  let installStallTimer: ReturnType<typeof setTimeout> | null = null;

  const broadcast = (channel: string, payload?: unknown) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) {
        if (payload === undefined) win.webContents.send(channel);
        else win.webContents.send(channel, payload);
      }
    }
  };

  const clearInstallStallTimer = () => {
    if (installStallTimer) {
      clearTimeout(installStallTimer);
      installStallTimer = null;
    }
  };

  const stopInstallWatch = () => {
    clearInstallStallTimer();
    app.removeListener('before-quit', clearInstallStallTimer);
  };

  const failInstall = (message: string) => {
    if (!installInProgress) return;
    installInProgress = false;
    stopInstallWatch();
    opts?.onInstallFailed?.();
    broadcast('update-error', { message });
  };

  const beginInstall = () => {
    installInProgress = true;
    opts?.onBeforeQuitAndInstall?.();
    broadcast('update-installing');
    stopInstallWatch();
    installStallTimer = setTimeout(() => {
      failInstall('The updater did not restart the app after starting installation. Please try again or download the latest installer manually.');
    }, UPDATE_INSTALL_STALL_TIMEOUT_MS);
    installStallTimer.unref?.();
    app.once('before-quit', clearInstallStallTimer);
  };

  const onUpdateAvailable = (info: { version?: string; releaseDate?: string; releaseNotes?: unknown }) => {
    if (!isUpdateAvailable(info.version, app.getVersion())) return;

    isDownloaded = false;
    broadcast('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
      canInstall: support.canInstall,
      unsupportedReason: support.reason,
      manualUrl: support.manualUrl,
    });
  };

  const onDownloadProgress = (progress: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => {
    broadcast('update-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  };

  const onUpdateDownloaded = () => {
    isDownloaded = true;
    broadcast('update-ready');
  };

  const onUpdaterError = (err: Error) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Auto-updater error:', message);
    const wasInstalling = installInProgress;
    failInstall(message);
    // Notify renderer so UI can show error instead of stuck progress
    if (!wasInstalling) broadcast('update-error', { message });
  };

  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('download-progress', onDownloadProgress);
  autoUpdater.on('update-downloaded', onUpdateDownloaded);
  autoUpdater.on('error', onUpdaterError);

  const runInstallRequest = async (): Promise<InstallUpdateResult> => {
    try {
      if (!isDownloaded) {
        await autoUpdater.downloadUpdate();
      }

      const syncInstallError: { current: Error | null } = { current: null };
      const captureSyncError = (err: Error) => {
        syncInstallError.current = err instanceof Error ? err : new Error(String(err));
      };

      beginInstall();
      autoUpdater.once('error', captureSyncError);
      try {
        autoUpdater.quitAndInstall(false, true);
      } finally {
        autoUpdater.removeListener('error', captureSyncError);
      }

      if (syncInstallError.current) {
        const message = syncInstallError.current.message;
        failInstall(message);
        return { ok: false, error: message };
      }
      return { ok: true, phase: 'installing' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (installInProgress) failInstall(message);
      else broadcast('update-error', { message });
      return { ok: false, error: message };
    }
  };

  // IPC handlers
  ipcMain.handle('check-update', async (event) => {
    opts?.assertTrustedLocalRenderer?.(event, 'check-update');
    try {
      const result = await autoUpdater.checkForUpdates();
      const updateVersion = result?.updateInfo?.version;
      const available = isUpdateAvailable(updateVersion, app.getVersion(), result?.isUpdateAvailable);
      return {
        available,
        version: updateVersion,
        canInstall: support.canInstall,
        unsupportedReason: support.reason,
        manualUrl: support.manualUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { available: false, error: message };
    }
  });

  ipcMain.handle('install-update', async (event) => {
    opts?.assertTrustedLocalRenderer?.(event, 'install-update');
    if (!support.canInstall) {
      const message = support.reason ?? 'This Desktop install cannot be updated in place.';
      broadcast('update-error', { message });
      return { ok: false, error: message, manualUrl: support.manualUrl };
    }
    if (installInProgress) {
      return { ok: true, phase: 'installing' };
    }
    if (activeInstallRequest) {
      return activeInstallRequest;
    }
    activeInstallRequest = runInstallRequest().finally(() => {
      activeInstallRequest = null;
    });
    return activeInstallRequest;
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
    stopInstallWatch();
    autoUpdater.removeListener('update-available', onUpdateAvailable);
    autoUpdater.removeListener('download-progress', onDownloadProgress);
    autoUpdater.removeListener('update-downloaded', onUpdateDownloaded);
    autoUpdater.removeListener('error', onUpdaterError);
    ipcMain.removeHandler?.('check-update');
    ipcMain.removeHandler?.('install-update');
  };
}
