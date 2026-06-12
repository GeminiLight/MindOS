'use client';

/**
 * Visibility-aware polling hook: runs `callback` every `intervalMs` while the
 * document is visible, pauses entirely while hidden, and fires a catch-up run
 * when the tab becomes visible again. Mirrors the singleton pattern used by
 * lib/stores/sync-status-store.ts and lib/stores/mcp-store.ts, packaged for
 * per-component polls.
 */

import { useEffect, useRef } from 'react';

export interface VisiblePollingOptions {
  /** Master switch — false tears the poll down (default true). */
  enabled?: boolean;
  /** Run once immediately when the poll starts (default true). */
  immediate?: boolean;
}

export function useVisiblePolling(
  callback: () => void,
  intervalMs: number,
  options: VisiblePollingOptions = {},
): void {
  const { enabled = true, immediate = true } = options;
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = () => callbackRef.current();
    const start = () => {
      if (interval === null) interval = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        tick(); // catch up after returning to the tab
        start();
      }
    };

    if (immediate) tick();
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs, immediate]);
}
