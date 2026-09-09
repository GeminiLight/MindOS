'use client';

import { useSyncExternalStore } from 'react';

/**
 * Wall-clock time that is safe to render during SSR and hydration.
 *
 * Server components hand pages timestamps (recent files, trash entries) and
 * the client formats them relative to "now". Reading `Date.now()` in render
 * makes the server HTML depend on the server clock and the moment of the
 * request, so the client's first render can differ (minute boundary, clock
 * skew, locale) and React reports a hydration mismatch.
 *
 * This store returns `null` for the server snapshot and the hydration render;
 * React then re-renders synchronously with the client clock before paint, and
 * subscribers are re-notified once a minute so relative labels stay fresh.
 * Client-only renders (in-app navigation) get the clock immediately.
 */

const TICK_MS = 60_000;

let currentNow: number | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function readNow(): number {
  if (currentNow === null) currentNow = Date.now();
  return currentNow;
}

function tick(): void {
  currentNow = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (ticker === null) ticker = setInterval(tick, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

function getServerSnapshot(): null {
  return null;
}

/** `null` on the server and during hydration, the client clock (ms) afterwards; refreshes once a minute. */
export function useHydratedNow(): number | null {
  return useSyncExternalStore(subscribe, readNow, getServerSnapshot);
}

/** Drops the cached clock and timer so tests start from an un-hydrated state. */
export function resetHydratedNowForTests(): void {
  currentNow = null;
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
  listeners.clear();
}
