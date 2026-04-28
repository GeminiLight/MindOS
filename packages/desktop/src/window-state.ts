/**
 * Window state persistence — save/restore window position and size.
 */
import { BrowserWindow, screen } from 'electron';
import Store from 'electron-store';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

const store = new Store<{ windowState: WindowState }>({
  name: 'mindos-window-state',
  defaults: {
    windowState: { width: 1200, height: 800 },
  },
});

export function restoreWindowState(): WindowState {
  const saved = store.get('windowState');

  // Validate that the saved position is on a visible display
  if (saved.x !== undefined && saved.y !== undefined) {
    const displays = screen.getAllDisplays();
    const onScreen = displays.some((d) => {
      const { x, y, width, height } = d.bounds;
      return (
        saved.x! >= x &&
        saved.x! < x + width &&
        saved.y! >= y &&
        saved.y! < y + height
      );
    });
    if (!onScreen) {
      // Reset position if off-screen (e.g. monitor disconnected)
      return { width: saved.width, height: saved.height };
    }
  }

  return saved;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveWindowState(win: BrowserWindow): void {
  // Debounce saves (move/resize fire rapidly)
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    store.set('windowState', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
    });
  }, 300);
}
