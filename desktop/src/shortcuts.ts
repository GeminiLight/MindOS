/**
 * Global keyboard shortcuts.
 * Returns success boolean so caller can warn on conflict.
 */
import { globalShortcut, BrowserWindow } from 'electron';

export function registerShortcuts(mainWindow: BrowserWindow): boolean {
  // Toggle window visibility
  const ok = globalShortcut.register('CmdOrCtrl+Shift+M', () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (!ok) {
    console.warn('CmdOrCtrl+Shift+M shortcut registration failed — may conflict with another app');
  }
  return ok;
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
