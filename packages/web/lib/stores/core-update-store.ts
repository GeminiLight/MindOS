'use client';

import { create } from 'zustand';
import { getDesktopBridge } from '@/lib/desktop-bridge';

/**
 * Single owner of MindOS Core (runtime) auto-update state.
 *
 * Direction 1 of the update redesign: a Core update is cheap (it only restarts
 * services, never the app), so it should NOT demand a modal + progress bar the
 * user babysits. This store, created once per app, silently checks and
 * downloads in the background, then parks in `ready`; the new runtime is
 * promoted at the next launch (see desktop main `startLocalMode` boot
 * auto-apply), with an optional explicit `applyNow()` for "Apply now".
 *
 * It is a singleton (not a per-component hook) so the toast and the settings
 * panel observe the SAME check/download instead of each kicking off their own.
 */

export type CorePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'desktopTooOld'
  | 'applying'
  | 'error';

interface CoreUpdateState {
  phase: CorePhase;
  current: string;
  latest: string;
  size: number;
  progress: number;
  minDesktopVersion: string;
  error: string;
  /** Idempotent: wire bridge events and run the initial silent check + download. */
  init: () => void;
  /** Manual re-check (also auto-downloads when an update is found). */
  checkNow: () => Promise<void>;
  /** Apply a ready download now; restarts services and reloads. */
  applyNow: () => Promise<void>;
}

const INITIAL = {
  phase: 'idle' as CorePhase,
  current: '',
  latest: '',
  size: 0,
  progress: 0,
  minDesktopVersion: '',
  error: '',
};

// Module-level lifecycle guards; the store object is app-lifetime, so init
// must only ever wire listeners / run the first check once.
let started = false;
let unsubscribers: Array<() => void> = [];

export const useCoreUpdateStore = create<CoreUpdateState>((set, get) => {
  /** Check the registry and, when an update is available & compatible, download it silently. */
  async function checkAndDownload(): Promise<void> {
    const bridge = getDesktopBridge();
    if (!bridge?.checkCoreUpdate) return;
    set({ phase: 'checking', error: '' });
    let info;
    try {
      info = await bridge.checkCoreUpdate();
    } catch {
      // Can't reach the CDN; not an error worth surfacing. Stay idle.
      set({ phase: 'idle' });
      return;
    }
    set({ current: info.currentVersion });

    if (info.desktopTooOld) {
      set({ phase: 'desktopTooOld', latest: info.latestVersion, minDesktopVersion: info.minDesktopVersion });
      return;
    }
    if (!info.available) {
      set({ phase: 'idle' });
      return;
    }

    set({ phase: 'downloading', latest: info.latestVersion, size: info.size, progress: 0 });
    if (!bridge.downloadCoreUpdate) return;
    try {
      await bridge.downloadCoreUpdate(info.urls, info.latestVersion, info.size, info.sha256);
      set({ phase: 'ready' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A user-initiated cancel rejects with 'aborted'; fall back to idle.
      if (msg.includes('aborted')) set({ phase: 'idle' });
      else set({ phase: 'error', error: msg });
    }
  }

  return {
    ...INITIAL,

    init() {
      if (started) return;
      const bridge = getDesktopBridge();
      if (!bridge?.checkCoreUpdate) return; // browser / CLI: nothing to do
      started = true;

      if (bridge.onCoreUpdateProgress) {
        unsubscribers.push(bridge.onCoreUpdateProgress((p) => set({ progress: Math.round(p.percent) })));
      }
      if (bridge.onCoreUpdateAvailable) {
        unsubscribers.push(
          bridge.onCoreUpdateAvailable((i) => {
            if (i.ready) {
              set({ phase: 'ready', current: i.current, latest: i.latest });
            } else if (get().phase === 'idle') {
              // A fresh availability ping while we're idle: fetch + download it.
              void checkAndDownload();
            }
          }),
        );
      }

      void (async () => {
        // A download finished in a previous session and is waiting to apply.
        try {
          const pending = await bridge.getCoreUpdatePending?.();
          if (pending?.version) {
            set({ phase: 'ready', latest: pending.version });
            return;
          }
        } catch { /* ignore; fall through to a remote check */ }
        await checkAndDownload();
      })();
    },

    async checkNow() {
      await checkAndDownload();
    },

    async applyNow() {
      const bridge = getDesktopBridge();
      if (!bridge?.applyCoreUpdate) return;
      set({ phase: 'applying', error: '' });
      try {
        const result = await bridge.applyCoreUpdate();
        if (result?.version) set({ current: result.version });
        // The main process reloads the window after the swap.
      } catch (err) {
        set({ phase: 'error', error: err instanceof Error ? err.message : 'Apply failed' });
      }
    },
  };
});

/** Test-only: reset lifecycle guards and state between cases. */
export function __resetCoreUpdateStoreForTests(): void {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  started = false;
  useCoreUpdateStore.setState({ ...INITIAL });
}
