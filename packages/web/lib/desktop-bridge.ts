'use client';

/**
 * Single source of truth for the Electron preload bridge (`window.mindos`).
 *
 * Both the update UI (panel + toast) and the core-update store talk to the
 * desktop main process through this surface. Keeping the type + accessor here
 * avoids each consumer re-declaring a partial copy that drifts out of sync
 * with `packages/desktop/src/preload.ts`.
 */

export interface MindosDesktopBridge {
  /* Native filesystem dialogs */
  selectDirectory?: () => Promise<string | null>;

  /* Desktop shell: electron-updater */
  checkUpdate: () => Promise<{
    available: boolean;
    version?: string;
    canInstall?: boolean;
    unsupportedReason?: string;
    manualUrl?: string;
    error?: string;
  }>;
  installUpdate: () => Promise<{ ok?: boolean; phase?: 'installing'; error?: string; manualUrl?: string } | void>;
  getAppInfo?: () => Promise<{ version?: string; mode?: string }>;

  /* MindOS Core runtime: independent hot update */
  checkCoreUpdate?: () => Promise<{
    available: boolean;
    currentVersion: string;
    latestVersion: string;
    urls: string[];
    size: number;
    sha256: string;
    minDesktopVersion: string;
    desktopTooOld: boolean;
  }>;
  downloadCoreUpdate?: (urls: string[], version: string, size: number, sha256: string) => Promise<void>;
  cancelCoreDownload?: () => Promise<void>;
  applyCoreUpdate?: () => Promise<{ ok: boolean; version?: string }>;
  getCoreUpdatePending?: () => Promise<{ version: string | null }>;

  /* Event listeners: each returns an unsubscribe fn */
  onUpdateAvailable?: (cb: (info: {
    version?: string;
    canInstall?: boolean;
    unsupportedReason?: string;
    manualUrl?: string;
  }) => void) => () => void;
  onUpdateProgress?: (cb: (progress: { percent: number }) => void) => () => void;
  onUpdateReady?: (cb: () => void) => () => void;
  onUpdateInstalling?: (cb: () => void) => () => void;
  onUpdateError?: (cb: (info: { message?: string }) => void) => () => void;
  onCoreUpdateProgress?: (cb: (progress: { percent: number; transferred: number; total: number }) => void) => () => void;
  onCoreUpdateAvailable?: (cb: (info: { current: string; latest: string; ready?: boolean }) => void) => () => void;
}

/**
 * Returns the desktop bridge when running inside the Electron shell, or `null`
 * in browser/CLI mode. Gated on `checkUpdate` so a partially-injected stub
 * (e.g. in tests) without the update surface is treated as absent.
 */
export function getDesktopBridge(): MindosDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { mindos?: MindosDesktopBridge };
  return w.mindos?.checkUpdate ? (w.mindos as MindosDesktopBridge) : null;
}
