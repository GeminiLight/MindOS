/**
 * Mutable runtime state shared by the main-process modules.
 *
 * main.ts used to hold all of this as module-level `let`s, which is why
 * startLocalMode and setupIPC could not be extracted: every reference was a
 * closure over a binding only that file owned. A single explicit object makes
 * the dependency visible and lets the boot flow, the IPC surface and the
 * window lifecycle live in separate files without passing a dozen arguments.
 *
 * Deliberately plain data — no behaviour. Modules read and write fields; the
 * meaning of each field stays documented here.
 */
import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'child_process';
import type { ProcessManager } from './process-manager';
import type { ConnectionMonitor } from './connection-monitor';
import { CoreUpdater } from './core-updater';

export interface ShellState {
  mainWindow: BrowserWindow | null;
  processManager: ProcessManager | null;
  connectionMonitor: ConnectionMonitor | null;
  /** In-flight `npm install` / `next build` child (not owned by ProcessManager) — killed on quit. */
  activeBuildChild: ChildProcess | null;
  /** Poll that waits for the web server to come back after a Core update. */
  activeRecoveryPoll: ReturnType<typeof setInterval> | null;
  cleanupUpdater: (() => void) | null;

  isQuitting: boolean;
  /** Set before quitAndInstall — skips cleanup so the installer can launch. */
  isUpdating: boolean;
  isRestarting: boolean;
  isCrashRepairing: boolean;
  isSwitchingMode: boolean;
  isBooting: boolean;
  trayAvailable: boolean;
  /** Only advertise the tray accelerator when the global shortcut registered. */
  toggleShortcutRegistered: boolean;

  currentMode: 'local' | 'remote';
  currentWebPort?: number;
  currentMcpPort?: number;
  currentRemoteAddress?: string;
  currentCoreVersion: string | null;

  readonly coreUpdater: CoreUpdater;
}

export const shell: ShellState = {
  mainWindow: null,
  processManager: null,
  connectionMonitor: null,
  activeBuildChild: null,
  activeRecoveryPoll: null,
  cleanupUpdater: null,

  isQuitting: false,
  isUpdating: false,
  isRestarting: false,
  isCrashRepairing: false,
  isSwitchingMode: false,
  isBooting: false,
  trayAvailable: false,
  toggleShortcutRegistered: false,

  currentMode: 'local',
  currentWebPort: undefined,
  currentMcpPort: undefined,
  currentRemoteAddress: undefined,
  currentCoreVersion: null,

  coreUpdater: new CoreUpdater(),
};

/** The live main window, or null when it is gone — the check every caller needs. */
export function liveMainWindow(): BrowserWindow | null {
  const win = shell.mainWindow;
  return win && !win.isDestroyed() ? win : null;
}

/** True while the app is tearing down or handing over to an installer. */
export function isShuttingDown(): boolean {
  return shell.isQuitting || shell.isUpdating;
}
