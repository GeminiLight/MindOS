import { useEffect, useMemo, useRef } from 'react';
import { startEventDrivenRefresh, type EventDrivenRefreshOptions } from '@/lib/event-driven-refresh';
import type { ServerEventType } from '@/lib/server-events';

export interface UseEventDrivenRefreshOptions extends Omit<EventDrivenRefreshOptions, 'isAppActive'> {
  /** When false nothing is subscribed and no poll runs. Default true. */
  enabled?: boolean;
}

/**
 * React binding for `startEventDrivenRefresh`. Callbacks (`refresh`, `accept`,
 * `shouldPoll`) are read through a ref so a consumer can pass fresh closures on
 * every render without tearing the subscription down; only `enabled`, the
 * event types and the timing constants restart it.
 */
export function useEventDrivenRefresh(options: UseEventDrivenRefreshOptions): void {
  const {
    enabled = true,
    eventTypes,
    debounceMs,
    fallbackPollMs = 0,
    connectedPollMs = 0,
    refreshOnResync,
  } = options;

  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const typesKey = eventTypes.join('|');
  const stableTypes = useMemo(
    () => (typesKey ? (typesKey.split('|') as Exclude<ServerEventType, 'ready'>[]) : []),
    [typesKey],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    return startEventDrivenRefresh({
      eventTypes: stableTypes,
      refresh: (reason) => latest.current.refresh(reason),
      accept: (event) => (latest.current.accept ? latest.current.accept(event) : true),
      shouldPoll: () => (latest.current.shouldPoll ? latest.current.shouldPoll() : true),
      debounceMs,
      fallbackPollMs,
      connectedPollMs,
      refreshOnResync,
    });
  }, [connectedPollMs, debounceMs, enabled, fallbackPollMs, refreshOnResync, stableTypes]);
}
