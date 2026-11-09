/**
 * Global keyboard shortcuts.
 *
 * `CmdOrCtrl+Shift+M` is registered globally, so it is taken from every other
 * app while MindOS runs (VS Code's Problems panel uses the same chord). Two
 * things follow from that:
 *   - MINDOS_DISABLE_GLOBAL_SHORTCUT=1 opts out entirely;
 *   - registration failure is reported to the caller so the tray menu does not
 *     advertise an accelerator that never fires.
 */
import { globalShortcut, BrowserWindow } from 'electron';

export const TOGGLE_WINDOW_ACCELERATOR = 'CmdOrCtrl+Shift+M';

/** Pure: whether the global toggle shortcut should be registered at all. */
export function globalShortcutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MINDOS_DISABLE_GLOBAL_SHORTCUT !== '1';
}

export function registerShortcuts(mainWindow: BrowserWindow): boolean {
  if (!globalShortcutEnabled()) {
    console.info('[MindOS] Global toggle shortcut disabled by MINDOS_DISABLE_GLOBAL_SHORTCUT=1');
    return false;
  }

  // Toggle window visibility
  const ok = globalShortcut.register(TOGGLE_WINDOW_ACCELERATOR, () => {
    // The shortcut stays registered globally — the window may be gone by the time it fires
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (!ok) {
    console.warn(
      `[MindOS] ${TOGGLE_WINDOW_ACCELERATOR} shortcut registration failed — another app likely owns it. ` +
      'The tray menu will not advertise it.',
    );
  }
  return ok;
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
