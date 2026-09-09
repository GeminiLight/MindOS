/**
 * Event-driven refresh with a polling fallback, shared by every mobile hook
 * that used to run its own `setInterval`.
 *
 * Matching server events (see `server-events.ts`) schedule one debounced
 * `refresh('event')`; `ready.resync` does the same (`'resync'`) because the
 * server could not replay what the client missed. Polling only runs when the
 * stream cannot do the job: `fallbackPollMs` ticks while the stream is not
 * connected, `connectedPollMs` ticks while it is (for data that has no server
 * event yet, such as automation approvals). Both intervals skip ticks while
 * the app is not in the foreground or while `shouldPoll()` says there is
 * nothing to watch, mirroring the AppState gating the old intervals had.
 *
 * A refresh that returns a promise is tracked: events arriving while it is
 * pending queue exactly one trailing refresh (with polling a missed tick
 * self-healed on the next one; with events the change would otherwise stay
 * invisible until the next event). Poll ticks simply skip while pending.
 *
 * Framework-free on purpose: hooks wrap `startEventDrivenRefresh` in one
 * `useEffect`, and this module carries the behaviour tests.
 */

import { AppState } from 'react-native';
import { getServerEventsState, subscribeServerEvents, type ServerEvent, type ServerEventType } from './server-events';

export const DEFAULT_EVENT_REFRESH_DEBOUNCE_MS = 150;

export type EventDrivenRefreshReason = 'event' | 'resync' | 'poll';

export interface EventDrivenRefreshOptions {
  /** Server event types that should trigger a refresh. `ready` is always observed for resync. */
  eventTypes: readonly Exclude<ServerEventType, 'ready'>[];
  refresh: (reason: EventDrivenRefreshReason) => unknown;
  /** Extra filter applied to matching events (for example a chatSessionId match). */
  accept?: (event: ServerEvent) => boolean;
  /** Coalesce bursts of events into one refresh. */
  debounceMs?: number;
  /** Poll period while the stream is not connected; 0 disables. */
  fallbackPollMs?: number;
  /** Poll period while the stream is connected; 0 disables. */
  connectedPollMs?: number;
  /** Poll gate evaluated per tick (for example "only while a run is active"). */
  shouldPoll?: () => boolean;
  /** Defaults to `AppState.currentState === 'active'`. */
  isAppActive?: () => boolean;
  /** Refresh when the server reports it could not replay missed events. Default true. */
  refreshOnResync?: boolean;
}

function defaultIsAppActive(): boolean {
  const appState = AppState as { currentState?: string | null } | undefined;
  return appState?.currentState === 'active';
}

function normalizePeriod(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as Promise<unknown>).then === 'function';
}

export function startEventDrivenRefresh(options: EventDrivenRefreshOptions): () => void {
  const debounceMs = normalizePeriod(options.debounceMs ?? DEFAULT_EVENT_REFRESH_DEBOUNCE_MS);
  const fallbackPollMs = normalizePeriod(options.fallbackPollMs);
  const connectedPollMs = normalizePeriod(options.connectedPollMs);
  const isAppActive = options.isAppActive ?? defaultIsAppActive;
  const shouldPoll = options.shouldPoll ?? (() => true);
  const refreshOnResync = options.refreshOnResync ?? true;

  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let debouncedReason: EventDrivenRefreshReason = 'event';
  let pending: Promise<void> | null = null;
  let rerunQueued = false;

  const run = (reason: EventDrivenRefreshReason): void => {
    if (stopped) return;
    if (pending) {
      // Polls are periodic and simply skip; events must not be lost.
      if (reason !== 'poll') rerunQueued = true;
      return;
    }
    let result: unknown;
    try {
      result = options.refresh(reason);
    } catch {
      // Consumers own their error state; a failing refresh must not stop the schedule.
      result = undefined;
    }
    if (!isThenable(result)) return;
    const settled: Promise<void> = result.then(() => undefined, () => undefined);
    pending = settled;
    void settled.then(() => {
      if (pending !== settled) return;
      pending = null;
      if (stopped || !rerunQueued) return;
      rerunQueued = false;
      run('event');
    });
  };

  const scheduleRefresh = (reason: EventDrivenRefreshReason): void => {
    if (stopped) return;
    if (debounceMs === 0) {
      run(reason);
      return;
    }
    if (debounceTimer !== null) {
      if (reason === 'resync') debouncedReason = 'resync';
      return;
    }
    debouncedReason = reason;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      run(debouncedReason);
    }, debounceMs);
  };

  const unsubscribes: Array<() => void> = [];
  for (const type of new Set(options.eventTypes)) {
    unsubscribes.push(subscribeServerEvents(type, (event: ServerEvent) => {
      if (options.accept && !options.accept(event)) return;
      scheduleRefresh('event');
    }));
  }
  unsubscribes.push(subscribeServerEvents('ready', (event) => {
    if (refreshOnResync && event.resync) scheduleRefresh('resync');
  }));

  const tick = (whileConnected: boolean): void => {
    if (stopped) return;
    const connected = getServerEventsState() === 'connected';
    if (connected !== whileConnected) return;
    if (!isAppActive()) return;
    if (!shouldPoll()) return;
    run('poll');
  };

  const fallbackInterval = fallbackPollMs > 0 ? setInterval(() => tick(false), fallbackPollMs) : null;
  const connectedInterval = connectedPollMs > 0 ? setInterval(() => tick(true), connectedPollMs) : null;

  return () => {
    if (stopped) return;
    stopped = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (fallbackInterval !== null) clearInterval(fallbackInterval);
    if (connectedInterval !== null) clearInterval(connectedInterval);
  };
}
