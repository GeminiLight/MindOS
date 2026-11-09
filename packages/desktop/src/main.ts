/**
 * MindOS Desktop — Electron Main Process
 *
 * Startup flow (one window, start to finish — see boot-shell.ts):
 * 1. Create the main window at its remembered size and load the boot shell
 * 2. Mode selection (first run only), healing, then services — all reported
 *    into that same window
 * 3. Success → navigate the same window to the product; failure → the boot
 *    shell shows the error and its recovery actions
 *
 * Mode switching flow (mid-session, where there IS product state to protect):
 * 1. Inject overlay on main window (keep old content visible)
 * 2. Start new mode in background
 * 3. Success → loadURL new mode; Failure → remove overlay, keep old mode
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'path';
import { createTray, updateTrayMenu, setToggleShortcutRegistered, type TrayCallbacks } from './tray';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { restoreWindowState, saveWindowState, saveWindowStateNow } from './window-state';
import { setupUpdater, checkForUpdatesNow } from './updater';
import { ensureInstallLocation } from './install-location';
import { setupAppMenu } from './app-menu';
import { ConnectionMonitor } from './connection-monitor';
import { clearActiveTunnel, showConnectWindow, showModeSelectWindow } from './connect-window';
import { cleanupOrphanedSshTunnel } from './ssh-tunnel';
import { testConnection } from './connection-sdk';
import { getEffectiveMindRootFromConfig } from './mindos-desktop-config';
import { ensureMindosCliShim, refreshMindosCliAndNotify, scheduleCliShimInstall } from './install-cli-shim';
import { resolvePreferUnpacked } from './resolve-packaged-asset';
import { registerMindosConnectSchemePrivileged, registerMindosConnectProtocol } from './mindos-connect-protocol';
import { getAppConfigStore } from './app-config-store';
import { desktopTelemetry } from './telemetry';
import { shell as shellState } from './shell-state';
import { configureLocalMode, forceTerminateProcessTree, startLocalMode } from './local-mode';
import {
  assertTrustedLocalRenderer,
  configureIpc,
  flushObsidianEditorDrafts,
  installMainWindowNavigationGuard,
  setupIPC,
} from './ipc-handlers';
import { installSmokeFileLogger } from './smoke-logger';
import { stopObsidianSecretStorageBroker } from './obsidian-broker-lifecycle';
import {
  bootShellOutcome,
  isBootShellActive,
  registerBootShellActions,
  releaseBootShell,
  shellStatus,
  showBootShell,
  showBootShellScreen,
} from './boot-shell';
import { currentWindowBackground } from './ui-theme';
import { mt } from './i18n/main-strings';
import { updateMcpClientConfigs } from './mcp-client-config';
import { promptForServerInBootShell, startRemoteMode } from './remote-mode';
import { healPreviousInstallation } from './boot-heal';
import {
  OVERLAY_IDS,
  disconnectedOverlayHtml,
  injectOverlay as injectOverlayInto,
  removeOverlay as removeOverlayFrom,
  restartingOverlayHtml,
  switchingOverlayHtml,
} from './overlays';
import {
  DESKTOP_HOME,
  invalidateConfig,
  loadConfig,
  needsDesktopModeSelectAtLaunch,
  readMindOsConfigFileUncached,
  resolveLocalMindOsBrowseUrl,
  saveDesktopMode,
} from './desktop-config';

registerMindosConnectSchemePrivileged();

installSmokeFileLogger();

// Intel Mac GPU workaround: some Intel HD/Iris/UHD GPUs are on Chromium's
// blocklist, which disables GPU compositing and breaks backdrop-filter.
// --ignore-gpu-blocklist re-enables GPU acceleration on these devices.
if (process.platform === 'darwin' && process.arch === 'x64') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

function getDesktopInstallPath(): string {
  let appPath = app.getPath('exe');
  if (process.platform === 'darwin') {
    const appMatch = appPath.match(/^(.*?\.app)(\/|$)/);
    if (appMatch) appPath = appMatch[1];
  } else if (process.platform === 'linux') {
    // AppImage sets APPIMAGE env to the actual .AppImage file path
    appPath = process.env.APPIMAGE || path.dirname(appPath);
  } else {
    // Windows: installation directory containing MindOS.exe
    appPath = path.dirname(appPath);
  }
  return appPath;
}

// ── Paths (prefer app.asar.unpacked on macOS — see electron-builder asarUnpack) ──
const MAIN_PRELOAD = resolvePreferUnpacked('dist-electron', 'preload', 'index.js');

// ── State (see shell-state.ts) ──

// Local mode lives in its own module; give it the two shell callbacks it needs.
// Function declarations below are hoisted, so this is safe at module scope.
configureIpc({
  changeMode: () => handleChangeMode(),
  refreshTray: (status) => refreshTray(status),
  getDesktopInstallPath: () => getDesktopInstallPath(),
});

configureLocalMode({
  refreshTray: (status) => refreshTray(status),
  restartServices: () => handleRestartServices(),
  getDesktopInstallPath: () => getDesktopInstallPath(),
});
// ── Single instance ──
// A second instance would run healPreviousInstallation() and kill THIS
// instance's web/MCP servers, then both would race on ~/.mindos/config.json.
// Refuse to start and hand focus to the running instance instead.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
      if (shellState.mainWindow.isMinimized()) shellState.mainWindow.restore();
      shellState.mainWindow.show();
      shellState.mainWindow.focus();
    }
  });
}


// ── Main Window ──

function createMainWindow(): BrowserWindow {
  const savedState = restoreWindowState();
  const win = new BrowserWindow({
    width: savedState?.width ?? 1200,
    height: savedState?.height ?? 800,
    x: savedState?.x, y: savedState?.y,
    minWidth: 800, minHeight: 600,
    title: 'MindOS',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 17 } : undefined,
    /**
     * Paint the backdrop the page is about to use. This was hardcoded to the
     * light `--background`, so dark-mode users got a white flash on every
     * launch — the exact thing the property is here to prevent.
     */
    backgroundColor: currentWindowBackground(),
    webPreferences: {
      preload: MAIN_PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  if (savedState?.maximized) win.maximize();

  /**
   * Hide instead of closing only when the tray is actually available *and*
   * there is something to come back to. During boot there is no product yet:
   * closing the window is the user abandoning startup, so it must quit rather
   * than leave an invisible background app with no way to reach it.
   */
  win.on('close', (e) => {
    if (isBootShellActive()) { shellState.isQuitting = true; return; }
    if (!shellState.isQuitting && !shellState.isUpdating && shellState.trayAvailable) { e.preventDefault(); win.hide(); }
  });
  win.on('resize', () => saveWindowState(win));
  win.on('move', () => saveWindowState(win));

  // macOS: forward fullscreen state so the Web titlebar row can drop the
  // traffic-light clearance (html[data-mac-fullscreen], see preload.ts)
  if (process.platform === 'darwin') {
    win.on('enter-full-screen', () => win.webContents.send('mindos:mac-fullscreen', true));
    win.on('leave-full-screen', () => win.webContents.send('mindos:mac-fullscreen', false));
  }

  return win;
}

// ── Helper ──

/** Update tray with current state — always includes ports/address */
function refreshTray(status: 'starting' | 'running' | 'error'): void {
  updateTrayMenu(shellState.currentMode, status, shellState.currentRemoteAddress, shellState.currentWebPort, shellState.currentMcpPort);
}

/** Overlay helpers bound to the main window (see overlays.ts). */
function injectOverlay(id: string, html: string): Promise<void> {
  return injectOverlayInto(shellState.mainWindow, id, html);
}

function removeOverlay(id: string): Promise<void> {
  return removeOverlayFrom(shellState.mainWindow, id);
}


// ── Tray Action: Switch Mode (show selection window, then switch if different) ──

async function handleChangeMode(): Promise<void> {
  if (shellState.isSwitchingMode || shellState.isQuitting || shellState.isUpdating) return;
  shellState.isSwitchingMode = true;
  try {
    const selectedMode = await showModeSelectWindow();
    if (!selectedMode || selectedMode === shellState.currentMode) return;
    await switchToMode(selectedMode);
  } finally {
    shellState.isSwitchingMode = false;
  }
}

// ── Tray Action: Switch Server (remote mode — show connect window) ──

async function handleSwitchServer(): Promise<void> {
  if (shellState.isQuitting || shellState.isUpdating) return;
  clearActiveTunnel(); // Close existing SSH tunnel before switching
  const result = await showConnectWindow();

  // "← Switch to Local Mode" is a mode change, not a cancel. Treating it as a
  // cancel here meant the button silently did nothing.
  if (result.kind === 'switch-local') {
    await switchToMode('local');
    return;
  }
  if (result.kind !== 'connected') return; // user closed the window

  if (shellState.connectionMonitor) shellState.connectionMonitor.stop();
  shellState.currentRemoteAddress = result.url;
  setupConnectionMonitor(result.url);
  shellState.mainWindow?.loadURL(result.url);
  refreshTray('running');
}

// ── Core: switch from current mode to target mode with preheat ──

async function switchToMode(targetMode: 'local' | 'remote'): Promise<void> {
  if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) return;
  if (shellState.isQuitting || shellState.isUpdating) return;

  const oldMode = shellState.currentMode;

  // 1. Overlay on current content
  await injectOverlay(OVERLAY_IDS.switching, switchingOverlayHtml());

  // 2. Preheat: keep old alive, start new
  const oldPM = shellState.processManager;
  const oldCM = shellState.connectionMonitor;
  const oldWebPort = shellState.currentWebPort;
  const oldMcpPort = shellState.currentMcpPort;
  const oldRemoteAddress = shellState.currentRemoteAddress;
  const shouldStopOldSecretStorageBroker = oldMode === 'local' && targetMode === 'remote';
  shellState.processManager = null;
  shellState.connectionMonitor = null;
  if (targetMode === 'local') { clearActiveTunnel(); shellState.currentRemoteAddress = undefined; }
  else { shellState.currentWebPort = undefined; shellState.currentMcpPort = undefined; }
  shellState.currentMode = targetMode;
  invalidateConfig();

  let url: string | null = null;
  let switchBackToLocal = false;
  try {
    if (targetMode === 'local') {
      url = await startLocalMode();
    } else {
      const outcome = await startRemoteMode(showConnectWindow);
      if (outcome.kind === 'connected') {
        url = outcome.url;
        setupConnectionMonitor(url);
      } else if (outcome.kind === 'switch-local') {
        switchBackToLocal = true;
      }
    }
  } catch { /* handled below */ }

  // 3. Apply
  if (url) {
    // Clean up any ongoing recovery poll from a previous crash
    if (shellState.activeRecoveryPoll) { clearInterval(shellState.activeRecoveryPoll); shellState.activeRecoveryPoll = null; }
    saveDesktopMode(targetMode);
    const openUrl = targetMode === 'local' ? resolveLocalMindOsBrowseUrl(url) : url;
    shellState.mainWindow.loadURL(openUrl);
    refreshTray('running');
    // Stop old processes with timeout to avoid hanging
    if (oldPM) {
      const stopOldProcesses = Promise.race([
        oldPM.stop(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('stop timeout')), 5000)),
      ]);
      stopOldProcesses.catch((err) => console.warn('[MindOS] Old process cleanup:', err instanceof Error ? err.message : err));
      if (shouldStopOldSecretStorageBroker) {
        stopOldProcesses.finally(() => {
          void stopObsidianSecretStorageBroker();
        }).catch(() => {});
      }
    } else if (shouldStopOldSecretStorageBroker) {
      void stopObsidianSecretStorageBroker();
    }
    if (oldCM) oldCM.stop();
    return;
  }

  // Revert silently — restore all state
  shellState.currentMode = oldMode;
  shellState.processManager = oldPM;
  shellState.connectionMonitor = oldCM;
  shellState.currentWebPort = oldWebPort;
  shellState.currentMcpPort = oldMcpPort;
  shellState.currentRemoteAddress = oldRemoteAddress;
  await removeOverlay(OVERLAY_IDS.switching);
  refreshTray(shellState.processManager ? 'running' : 'error');

  // The user asked for local mode from inside the remote screen.
  if (switchBackToLocal && oldMode !== 'local') {
    await switchToMode('local');
  }
}

// ── Tray Action: Restart Services ──

async function handleRestartServices(): Promise<void> {
  if (shellState.currentMode !== 'local' || shellState.isRestarting || shellState.isQuitting || shellState.isUpdating) return;
  shellState.isRestarting = true;
  invalidateConfig(); // Re-read config (setup wizard may have changed ports/paths)

  if (shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
    await injectOverlay(OVERLAY_IDS.switching, restartingOverlayHtml());
  }

  try {
    refreshTray('starting');
    if (shellState.processManager) {
      // Desktop owns the processes — restart them
      const previousMcpPort = shellState.currentMcpPort;
      await shellState.processManager.restart();
      shellState.currentWebPort = shellState.processManager.webPort;
      shellState.currentMcpPort = shellState.processManager.mcpPort;
      if (previousMcpPort !== undefined && shellState.currentMcpPort !== previousMcpPort) {
        updateMcpClientConfigs(previousMcpPort, shellState.currentMcpPort);
      }
      refreshTray('running');
      await removeOverlay(OVERLAY_IDS.switching);
      if (shellState.mainWindow && shellState.currentWebPort !== undefined) {
        shellState.mainWindow.loadURL(
          resolveLocalMindOsBrowseUrl(`http://127.0.0.1:${shellState.currentWebPort}`),
        );
      } else {
        shellState.mainWindow?.reload();
      }
    } else {
      // Connected to external CLI — do a full re-launch
      const url = await startLocalMode();
      if (url && shellState.mainWindow) {
        shellState.mainWindow.loadURL(resolveLocalMindOsBrowseUrl(url));
        refreshTray('running');
      }
      await removeOverlay(OVERLAY_IDS.switching);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await removeOverlay(OVERLAY_IDS.switching);
    refreshTray('error');
    dialog.showErrorBox(mt('restartFailedTitle'), msg);
  } finally {
    shellState.isRestarting = false;
  }
}

// ── Tray Callbacks ──

/**
 * (Re)build the application menu. Rebuilt when the user changes the language
 * so the menu bar follows the same preference as everything else.
 */
function installAppMenu(): void {
  setupAppMenu({
    onOpenMindRoot: () => {
      const configured = getEffectiveMindRootFromConfig(loadConfig());
      shell.openPath(configured || path.join(DESKTOP_HOME, 'MindOS', 'mind'));
    },
    onChangeMode: handleChangeMode,
    onRestartServices: handleRestartServices,
    onCheckForUpdates: () => checkForUpdatesNow(),
    getCoreVersion: () => shellState.currentCoreVersion,
    onLanguageChanged: () => {
      installAppMenu();
      refreshTray(shellState.processManager || shellState.currentRemoteAddress ? 'running' : 'starting');
    },
  });
}

const trayCallbacks: TrayCallbacks = {
  onChangeMode: handleChangeMode,
  onOpenMindRoot: () => {
    const configured = getEffectiveMindRootFromConfig(loadConfig());
    shell.openPath(configured || path.join(DESKTOP_HOME, 'MindOS', 'mind'));
  },
  onRestartServices: handleRestartServices,
  onSwitchServer: handleSwitchServer,
  onReconnect: async () => {
    if (!shellState.currentRemoteAddress || !shellState.mainWindow || shellState.mainWindow.isDestroyed()) return;
    refreshTray('starting');
    try {
      const result = await testConnection(shellState.currentRemoteAddress);
      if (result.status === 'online') {
        void removeOverlay(OVERLAY_IDS.disconnected);
        shellState.mainWindow.reload();
        refreshTray('running');
      } else {
        refreshTray('error');
      }
    } catch {
      refreshTray('error');
    }
  },
  onRefreshCliShim: () => { void refreshMindosCliAndNotify(shellState.mainWindow); },
};

// ── Connection Monitor ──

function setupConnectionMonitor(url: string): void {
  if (shellState.connectionMonitor) shellState.connectionMonitor.stop();
  shellState.connectionMonitor = new ConnectionMonitor(url, {
    onLost: () => {
      shellState.mainWindow?.webContents.send('connection-lost');
      refreshTray('error');
      void injectOverlay(OVERLAY_IDS.disconnected, disconnectedOverlayHtml());
    },
    onRestored: () => {
      shellState.mainWindow?.webContents.send('connection-restored');
      void removeOverlay(OVERLAY_IDS.disconnected);
      shellState.mainWindow?.reload();
      refreshTray('running');
    },
  });
  shellState.connectionMonitor.start();
}

// ── Boot Shell Action Handler ──

async function handleBootAction(actionId: string): Promise<void> {
  switch (actionId) {
    case 'install-node':
      shell.openExternal('https://nodejs.org/');
      break;
    case 'switch-remote': {
      // A failed local boot can leave a ProcessManager with half-started web/MCP
      // children; remote mode never touches them, so release them here.
      if (shellState.processManager) {
        const pm = shellState.processManager;
        shellState.processManager = null;
        pm.removeAllListeners();
        await pm.stop().catch((err) => {
          console.warn('[MindOS] Failed to stop local services before switching to remote:', err instanceof Error ? err.message : err);
        });
      }
      shellState.currentMode = 'remote';
      saveDesktopMode('remote');
      await bootApp();
      break;
    }
    case 'retry':
      if (shellState.isBooting) break;
      shellState.isBooting = true;
      shellStatus({ status: 'detecting' });
      try { await bootApp(); } finally { shellState.isBooting = false; }
      break;
    case 'quit':
      app.quit();
      break;
    case 'select-mode': {
      // The cards render in this same window — no picker to open, nothing to
      // close, and no way to end up with neither a picker nor a window.
      showBootShellScreen('modes');
      const result = await bootShellOutcome();
      if (result.kind === 'mode') {
        shellState.currentMode = result.mode;
        saveDesktopMode(result.mode, { allowSeedWebSetup: true });
        showBootShellScreen('boot');
        await bootApp();
      } else if (result.kind === 'connected') {
        shellState.currentMode = 'remote';
        saveDesktopMode('remote');
        showBootShellScreen('boot');
        await bootApp();
      }
      break;
    }
  }
}

// ── Boot App (resolve a URL, then navigate the main window to it) ──

/** Tray, IPC, shortcuts and updaters are wired once, after the first success. */
let shellServicesInstalled = false;

function installShellServices(win: BrowserWindow): void {
  if (shellServicesInstalled) return;
  shellServicesInstalled = true;

  setupIPC();
  try {
    const trayInstance = createTray(win, trayCallbacks);
    if (!trayInstance) {
      // createTray swallowed the error and returned null — same recovery as catch
      console.warn('[MindOS] Tray creation returned null — close will quit instead of hide');
      shellState.trayAvailable = false;
    } else {
      shellState.trayAvailable = true;
    }
  } catch (trayErr) {
    console.warn('[MindOS] Tray creation failed — close will quit instead of hide:', (trayErr as Error)?.message);
    shellState.trayAvailable = false;
  }
  // The tray menu only advertises the accelerator when it really registered.
  setToggleShortcutRegistered(registerShortcuts(win));
  shellState.cleanupUpdater = setupUpdater({
    onBeforeQuitAndInstall: () => { shellState.isUpdating = true; },
    onInstallFailed: () => { shellState.isUpdating = false; },
    assertTrustedLocalRenderer,
  });

  // Core Hot Update: silent check 30s after startup
  setTimeout(async () => {
    if (shellState.currentMode !== 'local' || !shellState.currentCoreVersion) return;
    try {
      // Check for pending download first (user downloaded but didn't apply last session)
      const pending = shellState.coreUpdater.getPendingVersion(shellState.currentCoreVersion);
      if (pending && shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
        shellState.mainWindow.webContents.send('core-update-available', {
          current: shellState.currentCoreVersion,
          latest: pending,
          ready: true,
        });
        return;
      }
      // Otherwise check remote
      const info = await shellState.coreUpdater.check(shellState.currentCoreVersion);
      if (info.available && !info.desktopTooOld && shellState.mainWindow && !shellState.mainWindow.isDestroyed()) {
        shellState.mainWindow.webContents.send('core-update-available', {
          current: info.currentVersion,
          latest: info.latestVersion,
          ready: false,
        });
      }
    } catch { /* silent check — don't bother user */ }
  }, 30_000);
}

async function bootApp(): Promise<void> {
  const win = shellState.mainWindow;
  if (!win || win.isDestroyed()) return;

  let url: string | null = null;

  try {
    if (shellState.currentMode === 'local') {
      url = await startLocalMode();
    } else {
      const outcome = await startRemoteMode(promptForServerInBootShell);
      if (outcome.kind === 'connected') {
        url = outcome.url;
        setupConnectionMonitor(url);
      } else if (outcome.kind === 'switch-local') {
        // "← Switch to Local Mode" from the first-run remote screen used to
        // resolve null, which app.whenReady() read as a cancel and quit on.
        shellState.currentMode = 'local';
        saveDesktopMode('local', { allowSeedWebSetup: true });
        showBootShellScreen('boot');
        await bootApp();
        return;
      } else {
        showBootShellScreen('boot');
        shellStatus({
          error: mt('remoteSetupCancelled'),
          actions: [
            { id: 'retry', label: 'retry', primary: true },
            { id: 'select-mode', label: 'selectMode' },
            { id: 'quit', label: 'quit' },
          ],
        });
        return;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    shellStatus({
      error: msg,
      actions: [
        { id: 'retry', label: 'retry', primary: true },
        { id: 'quit', label: 'quit' },
      ],
    });
    return;
  }

  if (!url) return; // the boot shell is showing an error + actions, wait for the user

  installShellServices(win);
  refreshTray('running');

  /**
   * Hand the connect channels back *before* the product can load.
   *
   * This ordering is the whole security argument for hosting the boot shell
   * in the main window: by the time a page from the loopback origin exists,
   * `connect:*` is unregistered. Pinned by desktop-shell-contract.
   */
  releaseBootShell();

  const loadUrl = shellState.currentMode === 'local' ? resolveLocalMindOsBrowseUrl(url) : url;
  win.loadURL(loadUrl);
}

/**
 * Listeners that outlive every navigation, installed once with the window.
 *
 * These used to be re-registered inside bootApp (and defensively removed
 * first) because the window was created there. The window now exists for the
 * whole session, so they are attached once and simply branch on whether the
 * boot shell is still up.
 */
function installMainWindowLoadHandlers(win: BrowserWindow): void {
  win.webContents.on('did-fail-load', (_event, code, desc, failedUrl, isMainFrame) => {
    // Sub-frame failures (embedded iframes) and ERR_ABORTED (-3: a navigation
    // superseded by a newer loadURL, e.g. right after apply-core-update) are not
    // main-page failures — surfacing them raised a modal over a healthy app.
    if (!isMainFrame || code === -3) return;
    console.error('[MindOS] main window did-fail-load', code, desc, failedUrl);

    // A boot shell that will not load means the install itself is broken;
    // there is no product window to fall back to, so say so and stop.
    if (isBootShellActive()) {
      dialog.showErrorBox(
        mt('pageLoadFailedTitle'),
        `${mt('pageLoadFailedMessage', { url: failedUrl })}\n\n${desc} (code ${code})`,
      );
      app.quit();
      return;
    }

    if (!win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: mt('pageLoadFailedTitle'),
        message: mt('pageLoadFailedMessage', { url: failedUrl }),
        detail: `${desc} (code ${code})\n\n${mt('pageLoadFailedTip')}`,
      }).then(() => {
        if (!win.isDestroyed()) win.show();
      }).catch((err) => {
        console.warn('[MindOS] Error showing load failure dialog:', err);
      });
    }
  });

  let devtoolsOpened = false;
  win.webContents.on('did-finish-load', () => {
    if (process.env.MINDOS_DESKTOP_CI_LOG && shellState.currentMode === 'local' && !isBootShellActive()) {
      void win.webContents.executeJavaScript('Boolean(window.mindos && document.body && document.body.innerText.trim())')
        .then(ready => { if (ready) console.info('[MindOS] Desktop renderer ready'); })
        .catch(error => console.error('[MindOS] Desktop renderer smoke failed:', error));
    }
    // The window is shown as soon as *anything* has painted — boot shell
    // included. Waiting for the product meant staring at an empty desktop for
    // the whole first-run build.
    if (!win.isVisible()) win.show();
    if (!devtoolsOpened && !isBootShellActive() && process.env.MINDOS_OPEN_DEVTOOLS === '1') {
      devtoolsOpened = true;
      win.webContents.openDevTools({ mode: 'detach' });
    }
    // macOS: resend fullscreen state — each load creates a fresh document,
    // so the html attribute must be rebuilt (Cmd+R, connection-lost recovery)
    if (process.platform === 'darwin' && !win.isDestroyed()) {
      win.webContents.send('mindos:mac-fullscreen', win.isFullScreen());
    }
  });

  // Fallback: if did-finish-load never fires, show the window anyway rather
  // than leaving the user with no visible app at all.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 10000);
}

// ── App Lifecycle ──

app.whenReady().then(async () => {
  // Second instance: app.quit() is already queued — don't start servers or heal
  if (!hasSingleInstanceLock) return;

  if (!await ensureInstallLocation({
    platform: process.platform, packaged: app.isPackaged, exe: app.getPath('exe'),
    locale: app.getLocale(), smoke: Boolean(process.env.MINDOS_DESKTOP_CI_LOG),
    move: () => app.moveToApplicationsFolder(), quit: () => app.quit(),
    prompt: async options => (await dialog.showMessageBox({ type: 'question', ...options })).response,
    showError: async message => { await dialog.showMessageBox({ type: 'error', title: 'MindOS', message }); },
  })) return;

  registerMindosConnectProtocol();

  // Set up bilingual application menu (replaces default English-only menu on Windows/Linux)
  installAppMenu();

  registerBootShellActions(handleBootAction);

  const stopBoot = desktopTelemetry.startTimer('desktop.boot.total');
  try {
    cleanupOrphanedSshTunnel();

    const needsModeSelect = needsDesktopModeSelectAtLaunch();
    if (!needsModeSelect) {
      const disk = readMindOsConfigFileUncached();
      shellState.currentMode = disk.desktopMode === 'remote' ? 'remote' : 'local';
    }

    /**
     * The window comes first, before healing, before services, before the
     * mode is even known.
     *
     * The user gets immediate feedback in the window they will keep, at the
     * size and position they left it, and nothing jumps or disappears later.
     * It is also the only window the app opens during startup.
     */
    const win = createMainWindow();
    shellState.mainWindow = win;
    installMainWindowNavigationGuard(win);
    installMainWindowLoadHandlers(win);
    showBootShell(win, { modeSelect: needsModeSelect });

    if (needsModeSelect) {
      const chosen = await bootShellOutcome();
      if (chosen.kind === 'mode') {
        shellState.currentMode = chosen.mode;
        saveDesktopMode(chosen.mode, { allowSeedWebSetup: true });
      } else if (chosen.kind === 'connected') {
        // The user went through the remote screen inside the cards flow.
        shellState.currentMode = 'remote';
        saveDesktopMode('remote', { allowSeedWebSetup: true });
      } else {
        // Closing the window during mode selection means "give up".
        stopBoot({ modeSelected: false, success: false });
        app.quit();
        return;
      }
      showBootShellScreen('boot');
    }

    // CLI shim install is deferred until the shell has painted: on Windows the
    // PATH registry step shells out to PowerShell and used to white-screen every
    // launch. Steady-state launches skip it entirely via the install stamp.
    scheduleCliShimInstall(win, () => {
      ensureMindosCliShim({ appendPath: process.env.MINDOS_DISABLE_CLI_SHIM_PATH_APPEND !== '1' }).catch((e) => {
        console.warn('[MindOS] Deferred CLI shim install failed:', e);
      });
    });

    await healPreviousInstallation({ onProgress: (message) => shellStatus({ status: 'healing', message }) });
    await bootApp();
    stopBoot({ mode: shellState.currentMode, modeSelected: true, success: true });
  } catch (error) {
    stopBoot({ mode: shellState.currentMode, success: false });
    throw error;
  }
});

app.on('window-all-closed', () => {
  if (!shellState.trayAvailable && !shellState.isQuitting && !shellState.isUpdating) app.quit();
});
app.on('activate', () => { if (shellState.mainWindow) shellState.mainWindow.show(); });

app.on('before-quit', (e) => {
  // When updating via electron-updater, skip cleanup — let the installer relaunch the app
  if (shellState.isUpdating) return;
  if (!shellState.isQuitting) {
    e.preventDefault();
    shellState.isQuitting = true;
    unregisterShortcuts();
    // Synchronous save — the debounced saveWindowState timer never fires before app.exit
    if (shellState.mainWindow && !shellState.mainWindow.isDestroyed()) saveWindowStateNow(shellState.mainWindow);
    const cleanup = async () => {
      await flushObsidianEditorDrafts().catch(() => console.error('[Obsidian] Could not flush all recovery drafts before quit.'));
      // An in-flight `npm install` / `next build` is not owned by ProcessManager
      // and would otherwise outlive the app.
      if (shellState.activeBuildChild) {
        forceTerminateProcessTree(shellState.activeBuildChild);
        shellState.activeBuildChild = null;
      }
      // lastCleanExit lets the next boot skip the heal path. It must only be
      // recorded when every child confirmed exit: stop() resolves false when a
      // force-killed child never reported exit, and the 8s race rejects on hang.
      let childrenStopped = true;
      try {
        if (shellState.processManager) {
          const stopped = await Promise.race([
            shellState.processManager.stop(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stop timeout')), 8000)),
          ]);
          if (stopped === false) childrenStopped = false;
        }
      } catch { childrenStopped = false; }
      await stopObsidianSecretStorageBroker();
      if (shellState.connectionMonitor) shellState.connectionMonitor.stop();
      if (shellState.activeRecoveryPoll) { clearInterval(shellState.activeRecoveryPoll); shellState.activeRecoveryPoll = null; }
      if (shellState.cleanupUpdater) { shellState.cleanupUpdater(); shellState.cleanupUpdater = null; }
      clearActiveTunnel();
      if (childrenStopped) {
        try { getAppConfigStore().set('lastCleanExit', Date.now()); } catch { /* best-effort */ }
      } else {
        console.warn('[MindOS] Child processes did not confirm exit — not recording a clean exit, next launch will run the full heal path');
      }
      app.exit(0);
    };
    // Must use .then() — event handler cannot be async, but cleanup must complete before exit
    cleanup().catch(() => app.exit(1));
  }
});
