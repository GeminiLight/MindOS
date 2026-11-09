/**
 * Connect Window — local BrowserWindow for remote mode server configuration.
 * Loads connect.html and bridges IPC to shared/connection SDK.
 */
import { BrowserWindow, ipcMain, safeStorage, screen, session } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { resolvePreferUnpacked } from './resolve-packaged-asset';
import { mindosConnectPageUrl } from './mindos-connect-protocol';
import Store from 'electron-store';
import { testConnection, normalizeAddress } from './connection-sdk';
import type { SavedConnection } from './connection-sdk';
import { parseSshConfig, isSshAvailable, SshTunnel, PASSPHRASE_NEEDED, addKeyToAgent, isSshAgentRunning } from './ssh-tunnel';
import { findAvailablePort } from './port-finder';
import { getDesktopHome } from './desktop-home';
import { authenticateRemoteWebSession } from './remote-auth';
import { getUiLang, getUiLangPreference, setUiLangPreference } from './i18n/lang';
import { currentWindowBackground, getUiTheme, getUiThemePreference, normalizeUiThemePreference, setUiThemePreference } from './ui-theme';
import { MODE_SELECT_CHANNELS, registerModeSelectHandlers } from './connect-mode-handlers';

/**
 * What the connect / mode-select window produced.
 *
 * This used to be a bare `string | null`, with `null` meaning both "user
 * cancelled" and "user pressed ← Switch to Local Mode". `app.whenReady()` read
 * that null as a cancel and called `app.quit()`, so the back button on the
 * first-run remote screen quit the app. The three outcomes are now distinct.
 */
export type ConnectWindowResult =
  | { kind: 'connected'; url: string }
  | { kind: 'switch-local' }
  | { kind: 'cancelled' };

// Active SSH tunnel (shared across windows)
let activeTunnel: SshTunnel | null = null;

export function getActiveTunnel(): SshTunnel | null { return activeTunnel; }
export function adoptActiveTunnel(tunnel: SshTunnel): void {
  if (activeTunnel && activeTunnel !== tunnel) {
    activeTunnel.onDeath = undefined;
    activeTunnel.stop().catch((err) => {
      console.warn('[MindOS:ssh] Previous tunnel stop failed:', err instanceof Error ? err.message : err);
    });
  }
  activeTunnel = tunnel;
}

export function clearActiveTunnel(): void {
  if (activeTunnel) {
    activeTunnel.onDeath = undefined; // Prevent stale callback from firing
    activeTunnel.stop().catch((err) => {
      console.warn('[MindOS:ssh] Tunnel stop failed:', err instanceof Error ? err.message : err);
    });
    activeTunnel = null;
  }
}

/**
 * The connect dialogs share the main preload, which branches on the document
 * URL (see preload.ts). A second entry point would make the shared bridge a
 * rollup chunk, and a sandboxed preload cannot require a relative chunk.
 */
function connectPreloadPath(): string {
  return resolvePreferUnpacked('dist-electron', 'preload', 'index.js');
}

const MAX_CONNECTIONS = 5;

const store = new Store<{
  remoteConnections: SavedConnection[];
  remoteActiveConnection: string | null;
  /** Encrypted passwords keyed by server address */
  encryptedPasswords: Record<string, string>;
}>({
  name: 'mindos-connections',
  defaults: {
    remoteConnections: [],
    remoteActiveConnection: null,
    encryptedPasswords: {},
  },
});

// ── Password encryption ──

function savePassword(address: string, password: string): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const encrypted = safeStorage.encryptString(password).toString('base64');
    const passwords = store.get('encryptedPasswords');
    passwords[address] = encrypted;
    store.set('encryptedPasswords', passwords);
  } catch { /* encryption not available */ }
}

export function loadPassword(address: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const passwords = store.get('encryptedPasswords');
    const encrypted = passwords[address];
    if (!encrypted) return null;
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch { return null; }
}

function removePassword(address: string): void {
  try {
    const passwords = store.get('encryptedPasswords');
    delete passwords[address];
    store.set('encryptedPasswords', passwords);
  } catch { /* ignore */ }
}

// ── SSH passphrase storage (reuses safeStorage, keyed by host) ──

/** Storage key for an SSH passphrase: `ssh-passphrase://host` */
function sshPassphraseKey(host: string): string {
  return `ssh-passphrase://${host}`;
}

function saveSshPassphrase(host: string, passphrase: string): void {
  savePassword(sshPassphraseKey(host), passphrase);
}

function loadSshPassphrase(host: string): string | null {
  return loadPassword(sshPassphraseKey(host));
}

function removeSshPassphrase(host: string): void {
  removePassword(sshPassphraseKey(host));
}

/** Pure: `ssh://host:port` → its parts. Exported for tests. */
export function parseSshAddress(address: string): { host: string; remotePort: number } | null {
  const match = /^ssh:\/\/(.+):(\d+)$/.exec(address);
  if (!match) return null;
  const remotePort = Number.parseInt(match[2], 10);
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return null;
  return { host: match[1], remotePort };
}

// ── Storage operations ──
function getConnections(): SavedConnection[] {
  return store.get('remoteConnections')
    .sort((a, b) => new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime());
}

function saveConnection(conn: SavedConnection): void {
  let list = store.get('remoteConnections');
  const idx = list.findIndex(c => c.address === conn.address);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...conn };
  } else {
    list.unshift(conn);
  }
  list.sort((a, b) => new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime());
  if (list.length > MAX_CONNECTIONS) list = list.slice(0, MAX_CONNECTIONS);
  store.set('remoteConnections', list);
}

function removeConnection(address: string): void {
  const list = store.get('remoteConnections').filter(c => c.address !== address);
  store.set('remoteConnections', list);
}

export function getActiveRemoteConnection(): string | null {
  return store.get('remoteActiveConnection');
}

export function setActiveRemoteConnection(address: string | null): void {
  store.set('remoteActiveConnection', address);
}

/**
 * Find the most recent SSH connection for auto-reconnect on startup.
 * Returns { host, remotePort } if the last connection was SSH-based, null otherwise.
 */
export function getLastSshConnection(): { host: string; remotePort: number } | null {
  const sshConn = getConnections().find(c => c.address.startsWith('ssh://'));
  if (!sshConn) return null;
  return parseSshAddress(sshConn.address);
}

// ── IPC handlers registration helpers ──

/**
 * Only one connect-style surface owns the shared `connect:*` channels at a
 * time. Without this, closing a mode-select window removed the handlers a
 * simultaneously open connect window was still using.
 */
let handlerOwner: symbol | null = null;
/**
 * The webContents allowed to invoke those channels.
 *
 * Registration alone used to be the whole gate: while any connect window was
 * open, *any* renderer in the app could invoke `connect:ssh-connect` or
 * `connect:install-mindos`. That became load-bearing once the main window
 * started hosting the boot shell, since the main window outlives the shell and
 * then navigates to the product. Pinning the sender means a page on the
 * product origin cannot reach these even if a connect dialog is open.
 */
let handlerOwnerContents: Electron.WebContents | null = null;

function claimHandlers(owner: symbol, contents: Electron.WebContents): void {
  handlerOwner = owner;
  handlerOwnerContents = contents;
}

function safeHandle(channel: string, handler: (...args: any[]) => any): void {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // Channel might not exist yet, ignore
  }
  ipcMain.handle(channel, (event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    if (handlerOwnerContents && event.sender !== handlerOwnerContents) {
      throw new Error(`Refused ${channel}: sender is not the active connect surface`);
    }
    return handler(event, ...args);
  });
}

function releaseHandlers(owner: symbol, channels: readonly string[]): void {
  if (handlerOwner !== owner) return;
  handlerOwner = null;
  handlerOwnerContents = null;
  for (const ch of channels) {
    try { ipcMain.removeHandler(ch); } catch { /* ignore */ }
  }
}

/** Shared theme/language handlers — the shell language must not be window-local. */
function registerUiLangHandlers(): void {
  safeHandle('connect:get-ui-lang', () => ({
    preference: getUiLangPreference(),
    lang: getUiLang(),
  }));
  safeHandle('connect:set-ui-lang', (_: unknown, value: unknown) => ({
    preference: value === 'zh' || value === 'en' || value === 'system' ? value : 'system',
    lang: setUiLangPreference(value),
  }));
  // Appearance lives beside language: the boot shell and the connect dialogs
  // are the same shell and must not disagree about it.
  safeHandle('connect:get-ui-theme', () => ({
    preference: getUiThemePreference(),
    theme: getUiTheme(),
  }));
  safeHandle('connect:set-ui-theme', (_: unknown, value: unknown) => ({
    preference: normalizeUiThemePreference(value),
    theme: setUiThemePreference(value),
  }));
}

const UI_LANG_CHANNELS = [
  'connect:get-ui-lang', 'connect:set-ui-lang',
  'connect:get-ui-theme', 'connect:set-ui-theme',
] as const;

const FIT_CHANNEL = 'connect:fit-window';

/** In-flight SSH attempt, so `connect:ssh-cancel` can actually abort it. */
interface SshAttempt { cancelled: boolean }
let activeSshAttempt: SshAttempt | null = null;

async function abandonTunnel(tunnel: SshTunnel | null): Promise<void> {
  if (!tunnel) return;
  tunnel.onDeath = undefined;
  await tunnel.stop().catch(() => { /* best effort */ });
  if (activeTunnel === tunnel) activeTunnel = null;
}

/**
 * Register SSH tunnel + remote connection IPC handlers.
 *
 * Shared by every surface that can display the remote connection screen: the
 * mode-select dialog, the connect dialog, and the boot shell hosted in the
 * main window. `dismiss` is how a surface goes away once the flow resolves —
 * a dialog closes its window; the boot shell stays put and lets main navigate
 * it to the product, so it passes a no-op.
 */
function registerSshHandlers(
  resolvedRef: { value: boolean },
  resolveConnected: (url: string) => void,
  onSwitchLocal: () => void,
  dismiss: () => void,
): void {
  const safeClose = () => {
    try {
      dismiss();
    } catch { /* surface already gone */ }
  };

  const finishConnected = (url: string) => {
    resolvedRef.value = true;
    resolveConnected(url);
    safeClose();
  };

  safeHandle('connect:get-recent', () => {
    // SSH entries are shown in the SSH panel, HTTP entries in the HTTP panel.
    // Both are returned so neither kind can become unforgettable.
    return getConnections().map(c => ({
      ...c,
      hasPassword: !!loadPassword(c.address),
    }));
  });

  safeHandle('connect:get-saved-password', (_: unknown, address: string) => {
    // Normalize address to match the key used when saving (connect:connect normalizes before savePassword)
    const normalized = normalizeAddress(address);
    return normalized ? loadPassword(normalized) : null;
  });

  safeHandle('connect:test', async (_: unknown, address: string) => {
    return testConnection(address);
  });

  safeHandle('connect:connect', async (_: unknown, address: string, password: string | null) => {
    const url = normalizeAddress(address);
    if (!url) return { ok: false, code: 'errInvalidAddress' };

    if (password) {
      // Warn if sending password over unencrypted HTTP to a non-local server
      const isLocal = url.includes('://localhost') || url.includes('://127.0.0.1') || url.includes('://[::1]');
      const isHttps = url.startsWith('https://');
      if (!isLocal && !isHttps) {
        return { ok: false, code: 'errPlaintextPassword' };
      }
      const auth = await authenticateRemoteWebSession({
        serverUrl: url,
        password,
        cookieStore: session.defaultSession.cookies,
      });
      if (!auth.ok) return { ok: false, code: 'incorrectPassword', message: auth.error };
    }

    saveConnection({
      address: url,
      lastConnected: new Date().toISOString(),
      authMethod: password ? 'password' : 'token',
    });
    if (password) savePassword(url, password);
    setActiveRemoteConnection(url);

    finishConnected(url);
    return { ok: true };
  });

  safeHandle('connect:remove', (_: unknown, address: string) => {
    removeConnection(address);
    removePassword(address);
    // SSH entries also carry a stored key passphrase under a separate key —
    // forgetting the host must not leave the passphrase behind.
    const ssh = parseSshAddress(address);
    if (ssh) removeSshPassphrase(ssh.host);
    if (getActiveRemoteConnection() === address) setActiveRemoteConnection(null);
  });

  /** Complete SSH connection after user enters password (when authRequired was true) */
  safeHandle('connect:ssh-complete', async (_: unknown, sshHost: string, sshRemotePort: number, tunnelUrl: string, password: string) => {
    // Verify tunnel is still alive
    if (!activeTunnel || !activeTunnel.isAlive()) {
      return { ok: false, code: 'errTunnelDead' };
    }

    // Authenticate with password through the tunnel
    const auth = await authenticateRemoteWebSession({
      serverUrl: tunnelUrl,
      password,
      cookieStore: session.defaultSession.cookies,
    });
    if (!auth.ok) return { ok: false, code: 'incorrectPassword', message: auth.error };

    // Save connection with SSH address format
    saveConnection({
      address: `ssh://${sshHost}:${sshRemotePort}`,
      label: `${sshHost} (SSH)`,
      lastConnected: new Date().toISOString(),
      authMethod: 'password',
    });
    savePassword(`ssh://${sshHost}:${sshRemotePort}`, password);
    setActiveRemoteConnection(tunnelUrl);

    finishConnected(tunnelUrl);
    return { ok: true };
  });

  safeHandle('connect:switch-local', () => {
    resolvedRef.value = true;
    onSwitchLocal();
    safeClose();
  });

  safeHandle('connect:ssh-hosts', async () => {
    const available = await isSshAvailable();
    if (!available) return { available: false, hosts: [] };
    const hosts = parseSshConfig();
    return { available: true, hosts };
  });

  /**
   * Abort the in-flight tunnel attempt. Previously "cancel" only reset the
   * renderer's buttons: the tunnel kept being established, and either closed
   * the window behind the user's back or leaked an ssh child process.
   */
  safeHandle('connect:ssh-cancel', async () => {
    if (activeSshAttempt) activeSshAttempt.cancelled = true;
    await abandonTunnel(activeTunnel);
    return { ok: true };
  });

  safeHandle('connect:ssh-connect', async (_: unknown, host: string, remotePort: number) => {
    const attempt: SshAttempt = { cancelled: false };
    activeSshAttempt = attempt;
    try {
      await abandonTunnel(activeTunnel);

      // Check if we have a cached passphrase — try to preload it into ssh-agent
      const cachedPassphrase = loadSshPassphrase(host);
      if (cachedPassphrase && isSshAgentRunning()) {
        // Try to add the default key to ssh-agent with cached passphrase
        const home = getDesktopHome();
        const defaultKeys = ['id_ed25519', 'id_rsa', 'id_ecdsa'].map(k => path.join(home, '.ssh', k));
        for (const keyPath of defaultKeys) {
          if (existsSync(keyPath)) {
            await addKeyToAgent(keyPath, cachedPassphrase);
            break; // Only need to add one
          }
        }
      }
      if (attempt.cancelled) return { ok: false, cancelled: true, code: 'errCancelled' };

      // Retry up to 3 times to handle transient failures and port collisions
      let lastError = '';
      let passphraseNeeded = false;
      for (let attemptIndex = 0; attemptIndex < 3; attemptIndex++) {
        if (attempt.cancelled) return { ok: false, cancelled: true, code: 'errCancelled' };
        try {
          const localPort = await findAvailablePort(remotePort + attemptIndex);
          const tunnel = new SshTunnel(host, localPort, remotePort);
          await tunnel.start();
          activeTunnel = tunnel;

          // The user may have pressed Cancel while ssh was negotiating.
          if (attempt.cancelled) {
            await abandonTunnel(tunnel);
            return { ok: false, cancelled: true, code: 'errCancelled' };
          }

          const result = await testConnection(`http://localhost:${localPort}`);
          if (attempt.cancelled) {
            await abandonTunnel(tunnel);
            return { ok: false, cancelled: true, code: 'errCancelled' };
          }

          if (result.status === 'online') {
            const url = `http://localhost:${localPort}`;

            // If auth required, DON'T close window — let renderer handle password flow
            if (result.authRequired) {
              // Keep tunnel alive, return info to renderer for password input
              return { ok: true, url, authRequired: true, sshHost: host, sshRemotePort: remotePort, version: result.version };
            }

            // No auth needed — save connection and close window
            saveConnection({
              address: `ssh://${host}:${remotePort}`,
              label: `${host} (SSH)`,
              lastConnected: new Date().toISOString(),
              authMethod: 'token',
            });
            setActiveRemoteConnection(url);
            finishConnected(url);
            return { ok: true, url, authRequired: false, version: result.version };
          }

          // MindOS not running on remote
          await abandonTunnel(tunnel);
          return {
            ok: false,
            code: result.status === 'not-mindos' ? 'errMindosNotRunning' : 'errTunnelNoMindos',
          };
        } catch (retryErr: any) {
          lastError = retryErr?.message || 'SSH tunnel failed';
          await abandonTunnel(activeTunnel);
          if (attempt.cancelled) return { ok: false, cancelled: true, code: 'errCancelled' };

          // Detect passphrase needed
          if (lastError === PASSPHRASE_NEEDED) {
            passphraseNeeded = true;
            break;
          }

          // Don't retry non-transient SSH errors — they'll fail identically every time
          const errLower = lastError.toLowerCase();
          const nonRetryable =
            errLower.includes('permission denied') ||
            errLower.includes('host key verification failed') ||
            errLower.includes('no such identity') ||
            errLower.includes('connection refused');
          if (nonRetryable) break;

          if (attemptIndex < 2) await new Promise(r => setTimeout(r, 1000 * (attemptIndex + 1)));
        }
      }

      if (attempt.cancelled) return { ok: false, cancelled: true, code: 'errCancelled' };
      if (passphraseNeeded) {
        return { ok: false, code: 'errSshFailed', message: lastError, passphraseNeeded: true };
      }
      return { ok: false, code: 'errSshFailed', message: lastError };

    } catch (err: any) {
      return { ok: false, code: 'errSshFailed', message: err?.message };
    } finally {
      if (activeSshAttempt === attempt) activeSshAttempt = null;
    }
  });

  /** Add SSH key to agent with passphrase, then retry tunnel connection */
  safeHandle('connect:ssh-add-key', async (_: unknown, host: string, remotePort: number, passphrase: string, remember: boolean) => {
    const attempt: SshAttempt = { cancelled: false };
    activeSshAttempt = attempt;
    try {
      // Find the SSH key for this host
      const home = getDesktopHome();
      const defaultKeys = ['id_ed25519', 'id_rsa', 'id_ecdsa'].map(k => path.join(home, '.ssh', k));
      let keyAdded = false;

      for (const keyPath of defaultKeys) {
        if (existsSync(keyPath)) {
          const result = await addKeyToAgent(keyPath, passphrase);
          if (result.ok) {
            keyAdded = true;
            break;
          }
        }
      }

      if (!keyAdded) {
        return { ok: false, code: 'errSshKeyRejected' };
      }

      // Save passphrase if requested
      if (remember) {
        saveSshPassphrase(host, passphrase);
      }

      // Now retry the SSH connection (tunnel should work with the key in agent)
      await abandonTunnel(activeTunnel);
      if (attempt.cancelled) return { ok: false, cancelled: true, code: 'errCancelled' };

      const localPort = await findAvailablePort(remotePort);
      const tunnel = new SshTunnel(host, localPort, remotePort);
      await tunnel.start();
      activeTunnel = tunnel;
      if (attempt.cancelled) {
        await abandonTunnel(tunnel);
        return { ok: false, cancelled: true, code: 'errCancelled' };
      }

      const testResult = await testConnection(`http://localhost:${localPort}`);
      if (testResult.status === 'online') {
        const url = `http://localhost:${localPort}`;

        if (testResult.authRequired) {
          return { ok: true, url, authRequired: true, sshHost: host, sshRemotePort: remotePort, version: testResult.version };
        }

        saveConnection({
          address: `ssh://${host}:${remotePort}`,
          label: `${host} (SSH)`,
          lastConnected: new Date().toISOString(),
          authMethod: 'token',
        });
        setActiveRemoteConnection(url);
        finishConnected(url);
        return { ok: true, url, authRequired: false, version: testResult.version };
      }

      await abandonTunnel(tunnel);
      return { ok: false, code: 'errTunnelNoMindos' };
    } catch (err: any) {
      return { ok: false, code: 'errSshFailed', message: err?.message };
    } finally {
      if (activeSshAttempt === attempt) activeSshAttempt = null;
    }
  });
}

/** Channels registered by registerSshHandlers — for cleanup */
const REMOTE_CHANNELS = [
  'connect:get-recent', 'connect:get-saved-password', 'connect:test', 'connect:connect',
  'connect:remove', 'connect:switch-local', 'connect:ssh-hosts', 'connect:ssh-connect',
  'connect:ssh-complete', 'connect:ssh-add-key', 'connect:ssh-cancel',
] as const;

/**
 * Window geometry.
 *
 * These used to be fixed at 600/640 while the natural content height is ~363
 * (mode picker) and ~401 (remote screen) — roughly 40% of each window was dead
 * space, and the content floated in the middle of it. The windows now open
 * close to their content and `connect:fit-window` resizes them as panels
 * expand, so neither dead space nor clipping happens.
 */
const MODE_SELECT_HEIGHT = 420;
const CONNECT_WINDOW_DEFAULTS = {
  width: 480,
  height: 470,
  minWidth: 420,
  minHeight: 360,
  resizable: true,
  maximizable: false,
  title: 'MindOS',
  titleBarStyle: 'default' as const,
  show: false,
};

/** Fresh per window: the preference can change between opens. */
function connectWindowOptions() {
  return { ...CONNECT_WINDOW_DEFAULTS, backgroundColor: currentWindowBackground() };
}

/**
 * Resize a shell window to the height its content actually needs.
 *
 * The renderer measures and reports; main decides, because only main knows the
 * work area. Clamped so a runaway measurement can never produce a window
 * taller than the display or smaller than the minimum.
 */
function registerFitWindowHandler(win: BrowserWindow): void {
  safeHandle('connect:fit-window', (_: unknown, requested: unknown) => {
    if (win.isDestroyed()) return { applied: false };
    const desired = Number(requested);
    if (!Number.isFinite(desired)) return { applied: false };
    try {
      const area = screen.getDisplayMatching(win.getBounds()).workAreaSize;
      const maxHeight = Math.max(CONNECT_WINDOW_DEFAULTS.minHeight, Math.floor(area.height * 0.9));
      const height = Math.min(maxHeight, Math.max(CONNECT_WINDOW_DEFAULTS.minHeight, Math.ceil(desired)));
      const [width] = win.getContentSize();
      if (Math.abs(win.getContentSize()[1] - height) < 8) return { applied: false, height };
      win.setContentSize(width, height, false);
      return { applied: true, height };
    } catch (err) {
      console.warn('[MindOS] Could not fit the connect window:', (err as Error)?.message);
      return { applied: false };
    }
  });
}

/**
 * What a connect surface produced. `switch-local` is distinct from `cancelled`
 * so callers stop treating the back button as "the user wants to quit".
 */
export type ConnectSurfaceOutcome =
  | { kind: 'mode'; mode: 'local' | 'remote' }
  | { kind: 'connected'; url: string }
  | { kind: 'switch-local' }
  | { kind: 'cancelled' };

export interface ConnectSurfaceOptions {
  /** The window hosting connect.html — a dialog, or the main window at boot. */
  window: BrowserWindow;
  /** Offer the mode cards (first run, boot, tray "switch mode"). */
  includeModeSelect: boolean;
  /**
   * Let the content drive the window height.
   *
   * Dialogs size themselves to their content. The main window must not: its
   * geometry is the user's, restored from window-state, and a boot shell that
   * resized it would lose that the moment the product loaded.
   */
  allowFit: boolean;
  /** Dismiss the surface once a flow resolves. Dialogs close; the boot shell stays. */
  dismiss: () => void;
}

/**
 * Attach the connect UI's IPC to a window and report what the user chose.
 *
 * One surface owns the shared `connect:*` channels at a time (see
 * claimHandlers) and `release()` gives them back. Main must call `release()`
 * before navigating the window anywhere else — that, plus the preload's
 * protocol branch, is what keeps these channels unreachable from the product
 * origin.
 */
export function attachConnectSurface(
  options: ConnectSurfaceOptions,
): { outcome: Promise<ConnectSurfaceOutcome>; release: () => void } {
  const owner = Symbol('connect-surface');
  claimHandlers(owner, options.window.webContents);

  const resolvedRef = { value: false };
  let settle: (value: ConnectSurfaceOutcome) => void = () => {};
  const outcome = new Promise<ConnectSurfaceOutcome>((resolve) => { settle = resolve; });

  const channels = [
    ...REMOTE_CHANNELS,
    ...UI_LANG_CHANNELS,
    ...(options.includeModeSelect ? MODE_SELECT_CHANNELS : []),
    ...(options.allowFit ? [FIT_CHANNEL] : []),
  ];

  registerUiLangHandlers();
  if (options.allowFit) registerFitWindowHandler(options.window);
  if (options.includeModeSelect) {
    registerModeSelectHandlers(
      safeHandle,
      resolvedRef,
      (mode) => settle({ kind: 'mode', mode }),
      options.dismiss,
      options.window,
    );
  }

  // Picking "local" from the remote screen's back button is a mode choice, not
  // a cancellation — resolving null here used to quit the app on first run.
  registerSshHandlers(
    resolvedRef,
    (url) => settle({ kind: 'connected', url }),
    () => settle({ kind: 'switch-local' }),
    options.dismiss,
  );

  const release = () => {
    releaseHandlers(owner, channels);
    if (!resolvedRef.value) settle({ kind: 'cancelled' });
  };

  return { outcome, release };
}

/** Window options shared by the two standalone connect dialogs. */
function connectDialogOptions() {
  return {
    ...connectWindowOptions(),
    minimizable: false,
    // Independent window — not modal, not parented.
    // Modal + hidden titlebar on parent = dead lock on macOS.
    webPreferences: {
      preload: connectPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      /*
        Sandboxed, like the main window. This used to be `sandbox: false` on the
        belief that the sandbox broke custom-scheme loading on macOS. Measured
        on Electron 44 it does not: a sandboxed window loads mindos-connect://,
        gets its bridge, and round-trips IPC. The single self-contained preload
        (see connectPreloadPath) is what keeps that true — a sandboxed preload
        cannot require a sibling chunk.
      */
      sandbox: true,
    },
  };
}

/**
 * Show mode selection window (tray "switch mode").
 * Returns 'local' | 'remote' | null (null = the user closed the window)
 *
 * First-run mode selection no longer comes through here — it renders inside
 * the main window via the boot shell (see boot-shell.ts).
 */
export async function showModeSelectWindow(): Promise<'local' | 'remote' | null> {
  const modeWin = new BrowserWindow({ ...connectDialogOptions(), height: MODE_SELECT_HEIGHT });
  modeWin.once('ready-to-show', () => modeWin.show());
  modeWin.loadURL(mindosConnectPageUrl({ modeSelect: 'true' })).catch(err => {
    console.error('[MindOS] Failed to load connect.html for mode selection:', err);
  });

  const { outcome, release } = attachConnectSurface({
    window: modeWin,
    includeModeSelect: true,
    allowFit: true,
    dismiss: () => { if (!modeWin.isDestroyed()) modeWin.close(); },
  });
  modeWin.on('closed', release);

  const result = await outcome;
  if (result.kind === 'mode') return result.mode;
  // The remote screen inside this window resolves its own way: a completed
  // connection means remote, the back button means local.
  if (result.kind === 'connected') return 'remote';
  if (result.kind === 'switch-local') return 'local';
  return null;
}


/**
 * Show the connect window and resolve with what the user chose.
 * See ConnectWindowResult — 'cancelled' and 'switch-local' are distinct.
 */
export async function showConnectWindow(): Promise<ConnectWindowResult> {
  const connectWin = new BrowserWindow(connectDialogOptions());
  connectWin.once('ready-to-show', () => connectWin.show());
  connectWin.loadURL(mindosConnectPageUrl()).catch(err => {
    console.error('[MindOS] Failed to load connect.html for remote connection:', err);
  });

  const { outcome, release } = attachConnectSurface({
    window: connectWin,
    includeModeSelect: false,
    allowFit: true,
    dismiss: () => { if (!connectWin.isDestroyed()) connectWin.close(); },
  });
  connectWin.on('closed', release);

  const result = await outcome;
  if (result.kind === 'connected') return { kind: 'connected', url: result.url };
  if (result.kind === 'switch-local') return { kind: 'switch-local' };
  return { kind: 'cancelled' };
}
