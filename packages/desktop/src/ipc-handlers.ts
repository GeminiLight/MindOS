/**
 * Renderer-facing IPC surface and the trust guards around it.
 *
 * Extracted from main.ts. Every handler here is reachable from a renderer, so
 * the guards (isTrustedLocalRenderer / isAllowedMainWindowNavigation) are the
 * security boundary — keep them at the top of each registration, not inside
 * the body. Callbacks into the app shell are injected so this module and
 * main.ts do not import each other.
 */
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { spawn as spawnChild } from 'child_process';
import { isSafeExternalUrl } from './open-external-guard';
import { planUninstall } from './uninstall-plan';
import { resolveCoreDownloadRequest } from './core-updater';
import { getEffectiveMindRootFromConfig } from './mindos-desktop-config';
import { mt } from './i18n/main-strings';
import { startLocalMode } from './local-mode';
import { createObsidianEditorLauncher } from './obsidian-editor-launcher';
import { ensureMindosCliShim } from './install-cli-shim';
import { shell as shellState, liveMainWindow } from './shell-state';
import { OVERLAY_IDS, coreUpdateOverlayHtml, injectOverlay as injectOverlayInto, removeOverlay as removeOverlayFrom } from './overlays';
import { CONFIG_DIR, DESKTOP_HOME, invalidateConfig, loadConfig, resolveLocalMindOsBrowseUrl } from './desktop-config';
import {
  isAllowedMainWindowNavigation,
  isTrustedLocalRenderer,
  trustedLocalRendererError,
  type RendererTrustSnapshot,
} from './ipc-trust';

/** Injected by main.ts so this module never imports the app shell back. */
export interface IpcHooks {
  changeMode(): Promise<void>;
  refreshTray(status: 'starting' | 'running' | 'error'): void;
  getDesktopInstallPath(): string;
}

let hooks: IpcHooks;
export function configureIpc(value: IpcHooks): void { hooks = value; }

const refreshTray = (status: 'starting' | 'running' | 'error') => hooks.refreshTray(status);
const getDesktopInstallPath = () => hooks.getDesktopInstallPath();
const injectOverlay = (id: string, html: string) => injectOverlayInto(liveMainWindow(), id, html);
const removeOverlay = (id: string) => removeOverlayFrom(liveMainWindow(), id);

// ── IPC Handlers ──

export function rendererTrustSnapshot(event: IpcMainInvokeEvent): RendererTrustSnapshot {
  return {
    currentMode: shellState.currentMode,
    currentWebPort: shellState.currentWebPort,
    currentRemoteAddress: shellState.currentRemoteAddress,
    senderMatchesMainWindow:
      !!shellState.mainWindow &&
      !shellState.mainWindow.isDestroyed() &&
      event.sender === shellState.mainWindow.webContents,
    senderUrl: event.senderFrame?.url || event.sender.getURL(),
    mainWindowUrl:
      shellState.mainWindow && !shellState.mainWindow.isDestroyed()
        ? shellState.mainWindow.webContents.getURL()
        : undefined,
  };
}

export function assertTrustedLocalRenderer(event: IpcMainInvokeEvent, capability: string): void {
  const snapshot = rendererTrustSnapshot(event);
  if (isTrustedLocalRenderer(snapshot)) return;
  console.warn('[MindOS:ipc] blocked local-only capability', {
    capability,
    mode: snapshot.currentMode,
    senderUrl: snapshot.senderUrl,
    mainWindowUrl: snapshot.mainWindowUrl,
  });
  throw trustedLocalRendererError(capability);
}

export function isTrustedActiveMainWindowRenderer(event: IpcMainInvokeEvent): boolean {
  const snapshot = rendererTrustSnapshot(event);
  if (!snapshot.senderMatchesMainWindow) return false;
  return isAllowedMainWindowNavigation(snapshot.senderUrl, {
    currentMode: shellState.currentMode,
    currentWebPort: shellState.currentWebPort,
    currentRemoteAddress: shellState.currentRemoteAddress,
  });
}

export function assertTrustedActiveMainWindowRenderer(event: IpcMainInvokeEvent, capability: string): void {
  if (isTrustedActiveMainWindowRenderer(event)) return;
  throw trustedLocalRendererError(capability);
}

function handleLocalOnly<TArgs extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedLocalRenderer(event, channel);
    return handler(event, ...(args as TArgs));
  });
}

function handleActiveMainWindowOnly<TArgs extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedActiveMainWindowRenderer(event, channel);
    return handler(event, ...(args as TArgs));
  });
}

export function openExternalGuarded(url: string): void {
  // Only web/mail URLs may leave the app — file://, UNC and OS scheme
  // handlers can execute local programs (especially on Windows).
  if (!isSafeExternalUrl(url)) {
    console.warn('[MindOS] Blocked external open of non-web URL:', url.slice(0, 200));
    return;
  }
  shell.openExternal(url).catch((err) => {
    console.warn('[MindOS] Failed to open external URL:', err instanceof Error ? err.message : err);
  });
}

export function installMainWindowNavigationGuard(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedMainWindowNavigation(url, { currentMode: shellState.currentMode, currentWebPort: shellState.currentWebPort, currentRemoteAddress: shellState.currentRemoteAddress })) {
      return { action: 'allow' };
    }
    openExternalGuarded(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMainWindowNavigation(url, { currentMode: shellState.currentMode, currentWebPort: shellState.currentWebPort, currentRemoteAddress: shellState.currentRemoteAddress })) {
      return;
    }
    event.preventDefault();
    openExternalGuarded(url);
  });
}

const obsidianEditorLauncher = createObsidianEditorLauncher(() => {
  const owner = shellState.mainWindow;
  const port = shellState.currentWebPort;
  if (!owner || owner.isDestroyed() || shellState.currentMode !== 'local' || !port || shellState.isQuitting || shellState.isRestarting || shellState.isUpdating) return null;
  const token = loadConfig().authToken;
  if (typeof token !== 'string' || !token) return null;
  return {
    window: owner, baseUrl: new URL(owner.webContents.getURL()).origin, token,
    isCurrent: () => shellState.mainWindow === owner && shellState.currentMode === 'local' && shellState.currentWebPort === port
      && !shellState.isQuitting && !shellState.isRestarting && !shellState.isUpdating,
  };
}, path.join(__dirname, '../obsidian'), path.join(app.getPath('userData'), 'obsidian-drafts'));

export function setupIPC(): void {
  handleLocalOnly('obsidian:open-editor', (event, request: unknown) => obsidianEditorLauncher.open(event, request));
  handleActiveMainWindowOnly('get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    mode: shellState.currentMode,
  }));

  handleLocalOnly('open-mindroot', () => {
    const configured = getEffectiveMindRootFromConfig(loadConfig());
    shell.openPath(configured || path.join(DESKTOP_HOME, 'MindOS', 'mind'));
  });

  // Directory picker for onboarding setup
  handleLocalOnly('select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Knowledge Base Directory',
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // `switch-mode` is reachable from the renderer: the connection-lost overlay
  // offers "switch to local". `restart-services` and `switch-server` had
  // handlers here too, but no preload binding and no caller anywhere — the
  // tray and the app menu invoke handleRestartServices/handleSwitchServer
  // directly. Registering them only widened the renderer-reachable surface.
  handleActiveMainWindowOnly('switch-mode', () => hooks.changeMode());

  // ── Core Hot Update IPC ──

  handleActiveMainWindowOnly('check-core-update', async () => {
    // CRITICAL FIX: Always force a fresh read of shellState.currentCoreVersion for the check
    // This ensures that after apply(), the new version is immediately reflected
    if (shellState.currentMode !== 'local') {
      return { available: false, currentVersion: shellState.currentCoreVersion || '', latestVersion: '' };
    }

    // If shellState.currentCoreVersion is not set, it means startLocalMode hasn't been called yet
    // Try to read it from the runtime directory
    let versionToCheck = shellState.currentCoreVersion;
    if (!versionToCheck) {
      try {
        versionToCheck = shellState.coreUpdater.getCachedVersion();
        if (versionToCheck) {
          console.info(`[MindOS] Recovered shellState.currentCoreVersion from cache: ${versionToCheck}`);
        }
      } catch { /* ignore */ }
    }

    if (!versionToCheck) {
      return { available: false, currentVersion: '', latestVersion: '' };
    }

    return shellState.coreUpdater.check(versionToCheck);
  });

  // The renderer names only the version; urls/size/sha256 come from the manifest
  // cached by the last check() so a compromised page cannot pick the tarball and
  // its hash. The legacy (urls, version, size, sha256) call shape still works —
  // everything but `version` is ignored.
  handleLocalOnly('download-core-update', async (_e, ...args: unknown[]) => {
    const download = resolveCoreDownloadRequest(args, shellState.coreUpdater.getLastCheck());
    // Forward progress events to renderer
    const onProgress = (p: { percent: number; transferred: number; total: number }) => {
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        if (!win.isDestroyed()) win.webContents.send('core-update-progress', p);
      }
    };
    shellState.coreUpdater.on('progress', onProgress);
    try {
      await shellState.coreUpdater.download(download.urls, download.version, download.size, download.sha256);
    } finally {
      shellState.coreUpdater.removeListener('progress', onProgress);
    }
  });

  handleLocalOnly('cancel-core-download', () => {
    shellState.coreUpdater.cancelDownload();
  });

  handleActiveMainWindowOnly('get-core-update-pending', () => {
    return { version: shellState.coreUpdater.getPendingVersion(shellState.currentCoreVersion) };
  });

  handleLocalOnly('apply-core-update', async () => {
    if (shellState.isQuitting || shellState.isUpdating) throw new Error('App is shutting down');
    const previousVersion = shellState.currentCoreVersion;

    // Inject overlay before stopping services
    if (shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
      await injectOverlay(OVERLAY_IDS.coreUpdate, coreUpdateOverlayHtml());
    }

    let appliedVersion: string | null = null;
    try {
      // 1. Stop processes (release file locks for Windows)
      console.info(`[CoreUpdater] Applying update: stopping processes (current: v${previousVersion})`);
      if (shellState.processManager) {
        await shellState.processManager.stop();
        shellState.processManager = null;
      }

      // 2. Atomic file replacement
      const newRuntimeDir = shellState.coreUpdater.apply(previousVersion);
      const verifiedVersion = shellState.coreUpdater.getCachedVersion();
      console.info(`[CoreUpdater] Files replaced: ${newRuntimeDir}, verified version: ${verifiedVersion}`);

      // 2b. Refresh CLI shim so `mindos -v` reflects the new version (forced — the
      // runtime content changed even when the resolved cli.js path is identical)
      try { await ensureMindosCliShim({ appendPath: false, force: true }); } catch (e) {
        console.warn('[CoreUpdater] CLI shim refresh failed:', e);
      }

      // 3. Restart with new runtime (startLocalMode re-resolves → picks cached)
      invalidateConfig();
      const url = await startLocalMode();
      appliedVersion = shellState.currentCoreVersion;
      console.info(`[CoreUpdater] startLocalMode completed: url=${url}, version=${appliedVersion} (was: ${previousVersion})`);

      if (appliedVersion === previousVersion) {
        console.warn(`[CoreUpdater] WARNING: Version did not change after apply! (${previousVersion} → ${appliedVersion}). Runtime may not have been picked correctly.`);
      }

      if (url && shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
        const result = { ok: true, version: appliedVersion };
        // Clear Electron HTTP cache before loading the new page.
        // Without this, Electron may serve stale HTML/JS from disk cache,
        // causing the user to see old UI even though the backend is running new code.
        setTimeout(async () => {
          if (shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
            try {
              await shellState.mainWindow.webContents.session.clearCache();
            } catch (e) {
              console.warn('[CoreUpdater] clearCache failed:', e);
            }
            shellState.mainWindow.loadURL(resolveLocalMindOsBrowseUrl(url));
            refreshTray('running');
          }
        }, 100);
        return result;
      }
      return { ok: true, version: appliedVersion };
    } catch (err) {
      // Recovery: try to restart with whatever runtime is available
      console.error('[MindOS] Core update apply failed, recovering:', err);
      try {
        invalidateConfig();
        const url = await startLocalMode();
        appliedVersion = shellState.currentCoreVersion;
        if (url && shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
          try { await shellState.mainWindow.webContents.session.clearCache(); } catch { /* best effort */ }
          shellState.mainWindow.loadURL(resolveLocalMindOsBrowseUrl(url));
        }
      } catch (recoverErr) {
        console.error('[MindOS] Recovery also failed:', recoverErr);
        await removeOverlay(OVERLAY_IDS.coreUpdate);
        refreshTray('error');
      }
      throw err;
    }
  });

  // Uninstall: per-platform plan (trash / NSIS uninstaller / manual instructions).
  // Server-side cleanup (stop services, remove config) is handled by /api/uninstall
  // before this IPC is called.
  handleLocalOnly('uninstall-app', async () => {
    try {
      // Stop managed child processes first
      await shellState.processManager?.stop();

      const plan = planUninstall({
        platform: process.platform,
        installPath: getDesktopInstallPath(),
        appImagePath: process.env.APPIMAGE,
        fileExists: existsSync,
      });

      if (plan.kind === 'manual') {
        return {
          ok: false,
          error: plan.reason === 'package-manager'
            ? mt('uninstallPackageManager')
            : mt('uninstallNoUninstaller', { path: getDesktopInstallPath() }),
        };
      }

      if (plan.kind === 'run-uninstaller') {
        // NSIS uninstaller removes files + registry entry (and calls
        // ~/.mindos/uninstall.bat itself); detach so it survives our quit
        const child = spawnChild(plan.uninstallerPath, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        setTimeout(() => app.quit(), 500);
        return { ok: true };
      }

      // macOS / AppImage: trashing the bundle alone left the CLI shim, the
      // private Node runtime, cached Core runtimes and the PATH lines this app
      // wrote into the user's shell rc files. ~/.mindos/uninstall.sh already
      // knows how to undo all of that — it just was never invoked.
      await runDesktopCleanupScript();

      // trashItem is the modern async replacement for deprecated moveItemToTrash
      try {
        await shell.trashItem(plan.target);
      } catch (trashErr) {
        return {
          ok: false,
          error: mt('uninstallTrashFailed', {
            target: plan.target,
            message: (trashErr as Error)?.message ?? '',
          }),
        };
      }

      // Quit after a brief delay to let the IPC response reach the renderer
      setTimeout(() => app.quit(), 500);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Run ~/.mindos/uninstall.sh (written by install-cli-shim) so a macOS/Linux
 * uninstall removes the same residue the Windows uninstaller does. Best-effort:
 * a failure here must never block trashing the app.
 */
export async function runDesktopCleanupScript(): Promise<void> {
  if (process.platform === 'win32') return;
  const script = path.join(CONFIG_DIR, 'uninstall.sh');
  if (!existsSync(script)) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(done, 20_000);
    timer.unref?.();
    try {
      const child = spawnChild('/bin/sh', [script], { stdio: 'ignore', detached: false });
      child.on('exit', () => { clearTimeout(timer); done(); });
      child.on('error', (err) => {
        clearTimeout(timer);
        console.warn('[MindOS] Cleanup script failed:', err.message);
        done();
      });
    } catch (err) {
      clearTimeout(timer);
      console.warn('[MindOS] Could not run the cleanup script:', (err as Error)?.message);
      done();
    }
  });
}


/** Flush any unsaved isolated-editor drafts before the app exits. */
export function flushObsidianEditorDrafts(): Promise<void> {
  return obsidianEditorLauncher.flush();
}
