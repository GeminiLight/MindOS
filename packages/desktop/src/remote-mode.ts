/**
 * Remote mode: reach a MindOS server that runs somewhere else.
 *
 * Split out of main.ts (which had reached 995 lines) to mirror local-mode.ts:
 * main decides *when* to enter a mode, these modules decide *how*. Nothing
 * here calls back into main, so the boundary is a plain import.
 *
 * The order of attempts matters and is the whole design:
 *   1. the saved server, re-using a saved password if it needs one;
 *   2. the last SSH tunnel, rebuilt on a fresh local port;
 *   3. only then, ask the user — through whichever surface the caller passes.
 */
import { dialog, session } from 'electron';
import { findAvailablePort } from './port-finder';
import {
  adoptActiveTunnel,
  clearActiveTunnel,
  getActiveRemoteConnection,
  getLastSshConnection,
  loadPassword,
  setActiveRemoteConnection,
  showConnectWindow,
  type ConnectWindowResult,
} from './connect-window';
import { SshTunnel } from './ssh-tunnel';
import { testConnection } from './connection-sdk';
import { authenticateRemoteWebSession } from './remote-auth';
import { shell as shellState } from './shell-state';
import { bootShellOutcome, isBootShellActive, shellStatus, showBootShellScreen } from './boot-shell';
import { mt } from './i18n/main-strings';
import { checkRemoteCompat } from './remote-compat';
import { readMindOsConfigFileUncached } from './desktop-config';

async function authenticateSavedRemoteSession(serverUrl: string, passwordKey = serverUrl): Promise<boolean> {
  const password = loadPassword(passwordKey);
  if (!password) return false;

  const auth = await authenticateRemoteWebSession({
    serverUrl,
    password,
    cookieStore: session.defaultSession.cookies,
  });
  if (!auth.ok) {
    console.warn(`[MindOS] Saved remote password auth failed for ${serverUrl}: ${auth.error}`);
  }
  return auth.ok;
}

/**
 * Warn when a remote server is older than `minMindOsVersion`.
 *
 * The local runtime has always had this gate (mindos-runtime-pick.ts); remote
 * mode only displayed the version. The shell renders the server's page inside a
 * window with a hidden titlebar on macOS, so an incompatible server produces a
 * window with no drag region at all. Returns false when the user backs out.
 */
async function confirmRemoteCompatible(serverVersion: string | undefined): Promise<boolean> {
  const verdict = checkRemoteCompat({
    serverVersion,
    minVersion: readMindOsConfigFileUncached().minMindOsVersion as string | undefined,
  });
  if (verdict.ok) return true;

  const title = mt('remoteVersionTooOldTitle');
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title,
    message: title,
    detail: mt('remoteVersionTooOld', {
      serverVersion: verdict.serverVersion,
      minVersion: verdict.minVersion,
    }),
    buttons: [mt('cancel'), mt('connectAnyway')],
    defaultId: 0,
    cancelId: 0,
  };
  const result = shellState.mainWindow && !shellState.mainWindow.isDestroyed()
    ? await dialog.showMessageBox(shellState.mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

/**
 * Outcome of entering remote mode. `switch-local` is distinct from `cancelled`
 * so callers stop treating the back button as "the user wants to quit".
 */
export type RemoteModeOutcome =
  | { kind: 'connected'; url: string }
  | { kind: 'switch-local' }
  | { kind: 'cancelled' };

/**
 * Enter remote mode, asking the user for a server only if the saved one does
 * not answer.
 *
 * `prompt` is how that asking happens, and it differs by caller. At boot there
 * is no product on screen to protect, so the request renders inside the main
 * window's boot shell — one window, no stacking. Mid-session, the product page
 * is live and must not be unloaded, so the tray paths pass a dialog instead.
 */
export async function startRemoteMode(prompt: () => Promise<ConnectWindowResult>): Promise<RemoteModeOutcome> {
  shellStatus({ status: 'connecting' });
  const savedAddress = getActiveRemoteConnection();
  if (savedAddress) {
    try {
      const result = await testConnection(savedAddress);
      if (result.status === 'online' && await confirmRemoteCompatible(result.version)) {
        // If auth required, try saved password for seamless reconnect
        if (result.authRequired) {
          if (await authenticateSavedRemoteSession(savedAddress)) {
            shellState.currentRemoteAddress = savedAddress;
            return { kind: 'connected', url: savedAddress };
          }
          // No password or auth failed → ask the user
        } else {
          shellState.currentRemoteAddress = savedAddress;
          return { kind: 'connected', url: savedAddress };
        }
      }
    } catch { /* fall through */ }
  }

  // Auto-reconnect last SSH tunnel if saved address was ephemeral (localhost tunnel)
  const lastSsh = getLastSshConnection();
  if (lastSsh) {
    shellStatus({ status: 'connecting', message: mt('reconnectingSsh', { host: lastSsh.host }) });
    try {
      const localPort = await findAvailablePort(lastSsh.remotePort);
      const tunnel = new SshTunnel(lastSsh.host, localPort, lastSsh.remotePort);
      await tunnel.start();
      clearActiveTunnel(); // clean any stale reference before storing new tunnel

      const url = `http://localhost:${localPort}`;
      const result = await testConnection(url);
      if (result.status === 'online') {
        if (result.authRequired) {
          const passwordKey = `ssh://${lastSsh.host}:${lastSsh.remotePort}`;
          if (!(await authenticateSavedRemoteSession(url, passwordKey))) {
            await tunnel.stop().catch(() => {});
            // Saved password is absent, stale, or the auth request timed out.
            // Fall through to the connect form so the user can retry.
            return fromConnectWindow(await prompt());
          }
        }

        adoptActiveTunnel(tunnel);
        setActiveRemoteConnection(url);
        shellState.currentRemoteAddress = url;
        return { kind: 'connected', url };
      }
      // Tunnel up but MindOS not responding - fall through
      tunnel.stop().catch(() => {});
    } catch (err) {
      console.warn('[MindOS] SSH auto-reconnect failed:', (err as Error)?.message);
    }
  }

  return fromConnectWindow(await prompt());
}

function fromConnectWindow(result: ConnectWindowResult): RemoteModeOutcome {
  if (result.kind === 'connected') {
    shellState.currentRemoteAddress = result.url;
    return { kind: 'connected', url: result.url };
  }
  return result.kind === 'switch-local' ? { kind: 'switch-local' } : { kind: 'cancelled' };
}

/**
 * Ask for a server inside the boot shell rather than in a dialog.
 *
 * Only valid while the main window is still on the boot shell; once the
 * product is loaded, unloading it to show a form would discard the user's
 * live session, which is why the tray paths keep using showConnectWindow().
 */
export async function promptForServerInBootShell(): Promise<ConnectWindowResult> {
  if (!isBootShellActive()) return showConnectWindow();
  const pending = bootShellOutcome();
  showBootShellScreen('remote');
  const result = await pending;
  if (result.kind === 'connected') return { kind: 'connected', url: result.url };
  if (result.kind === 'switch-local') return { kind: 'switch-local' };
  // The mode cards are the other way back to local from this screen.
  if (result.kind === 'mode') {
    return result.mode === 'local' ? { kind: 'switch-local' } : { kind: 'cancelled' };
  }
  return { kind: 'cancelled' };
}
