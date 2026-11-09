/**
 * Boot shell — the startup UI, rendered inside the main window.
 *
 * MindOS used to open up to three windows before the product appeared: a
 * mode-select dialog (480x388), a splash (360x240), then the real window
 * (1200x800). Three identities, three sizes, three centre positions, and the
 * most informative moment of a first run — a 1–3 minute `npm install` plus
 * `next build` — got the smallest box on screen.
 *
 * The main window now exists from the first tick and hosts connect.html over
 * `mindos-connect://` while the services come up, then navigates itself to the
 * product. One window, one position, one identity.
 *
 * ## Why this does not widen the trust boundary
 *
 * - The preload branches on `location.protocol` (see preload.ts): the boot
 *   shell gets `mindosConnect`, the product origin gets `mindos`, neither gets
 *   both — and the document URL is not something a renderer can forge.
 * - `releaseBootShell()` hands the `connect:*` channels back *before* the
 *   product navigation, so they are unregistered by the time it loads.
 * - `safeHandle` additionally pins the sender, so even a connect dialog opened
 *   later cannot be driven by the page in the main window.
 * - `isTrustedLocalRenderer` keeps rejecting the privileged `mindos:*`
 *   channels throughout boot: it requires the sender to be on the managed
 *   loopback origin, and `mindos-connect://` is not.
 */
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { mindosConnectPageUrl } from './mindos-connect-protocol';
import { attachConnectSurface, type ConnectSurfaceOutcome } from './connect-window';
import type { ShellStatusPayload } from './connect-bridge';

export type { ConnectSurfaceOutcome };

interface ActiveBootShell {
  window: BrowserWindow;
  release: () => void;
  outcome: Promise<ConnectSurfaceOutcome>;
  /** An outcome promise resolves once; a retry needs a fresh one. */
  settled: boolean;
  /**
   * Last status pushed before the renderer was listening.
   *
   * Boot status starts flowing during healPreviousInstallation, which can beat
   * the first paint. The splash simply dropped those messages; replaying the
   * most recent one on did-finish-load means the first thing the user sees is
   * already current instead of a stale phase.
   */
  pending: ShellStatusPayload | null;
  ready: boolean;
}

let active: ActiveBootShell | null = null;

export function isBootShellActive(): boolean {
  return active !== null && !active.window.isDestroyed();
}

function arm(entry: ActiveBootShell): void {
  const surface = attachConnectSurface({
    window: entry.window,
    /**
     * Always, not only on first run. The cards can appear on any run — the
     * "choose mode" recovery action and the remote screen's back button both
     * lead there — and cards without handlers are buttons that do nothing.
     */
    includeModeSelect: true,
    // The main window's geometry belongs to the user (window-state.ts). A boot
    // shell that resized it would throw that away before the product loaded.
    allowFit: false,
    // Nothing to dismiss: main navigates this window to the product instead.
    dismiss: () => {},
  });
  entry.release = surface.release;
  entry.settled = false;
  entry.outcome = surface.outcome.then((result) => {
    entry.settled = true;
    return result;
  });
}

/**
 * Load the boot shell into `win`.
 *
 * `modeSelect` shows the mode cards (first run); otherwise the shell opens
 * straight into the progress state.
 */
export function showBootShell(win: BrowserWindow, options: { modeSelect: boolean }): void {
  releaseBootShell();

  const entry: ActiveBootShell = {
    window: win,
    release: () => {},
    outcome: Promise.resolve({ kind: 'cancelled' } as ConnectSurfaceOutcome),
    settled: false,
    pending: null,
    ready: false,
  };
  arm(entry);
  active = entry;

  win.webContents.once('did-finish-load', () => {
    if (active !== entry) return;
    entry.ready = true;
    if (entry.pending) {
      send(entry, entry.pending);
      entry.pending = null;
    }
  });

  const query: Record<string, string> = { shell: 'boot' };
  if (options.modeSelect) query.modeSelect = 'true';
  win.loadURL(mindosConnectPageUrl(query)).catch((err) => {
    console.error('[MindOS] Failed to load the boot shell:', (err as Error)?.message);
  });
}

/**
 * What the user chooses next in the boot shell.
 *
 * Re-arms when the previous flow already settled, so a retry after a failed
 * connection gets a live promise instead of the stale answer from last time.
 */
export function bootShellOutcome(): Promise<ConnectSurfaceOutcome> {
  const entry = active;
  if (!entry || entry.window.isDestroyed()) {
    return Promise.resolve({ kind: 'cancelled' });
  }
  if (entry.settled) arm(entry);
  return entry.outcome;
}

function send(entry: ActiveBootShell, data: ShellStatusPayload): void {
  if (entry.window.isDestroyed()) return;
  try {
    entry.window.webContents.send('shell:status', data);
  } catch (err) {
    console.warn('[MindOS] Could not push boot status:', (err as Error)?.message);
  }
}

/**
 * Push a boot status update.
 *
 * A no-op once the window has moved on to the product, which is what makes it
 * safe for the long-running local-mode paths to keep reporting progress after
 * a retry has already succeeded.
 */
export function shellStatus(data: ShellStatusPayload): void {
  const entry = active;
  if (!entry || entry.window.isDestroyed()) return;
  if (!entry.ready) {
    entry.pending = data;
    return;
  }
  send(entry, data);
}

/**
 * Ask the boot shell to show a particular screen.
 *
 * Used when a saved remote connection cannot be re-established: rather than
 * opening a connect dialog on top of the boot window, the boot shell itself
 * offers the form.
 */
export function showBootShellScreen(screen: 'remote' | 'modes' | 'boot'): void {
  const entry = active;
  if (!entry || entry.window.isDestroyed()) return;
  try {
    entry.window.webContents.send('shell:screen', screen);
  } catch (err) {
    console.warn('[MindOS] Could not switch the boot screen:', (err as Error)?.message);
  }
}

/**
 * Hand the `connect:*` channels back.
 *
 * Must run before the main window navigates to the product — that ordering is
 * the guarantee that the product origin cannot reach them. Pinned by a
 * contract test.
 */
export function releaseBootShell(): void {
  const entry = active;
  if (!entry) return;
  active = null;
  try {
    entry.release();
  } catch (err) {
    console.warn('[MindOS] Boot shell release failed:', (err as Error)?.message);
  }
}

/** Wire the boot shell's action buttons (retry / switch-remote / quit / select-mode). */
export function registerBootShellActions(handler: (actionId: string) => Promise<void> | void): void {
  ipcMain.removeHandler('shell:action');
  ipcMain.handle('shell:action', async (event, actionId: unknown) => {
    const entry = active;
    if (!entry || event.sender !== entry.window.webContents) {
      throw new Error('Refused shell:action: sender is not the boot shell');
    }
    if (typeof actionId !== 'string') return;
    await handler(actionId);
  });
}
