import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mindosClient } from '@/lib/api-client';
import {
  buildRecentAgentActivity,
  compactAgentActivityError,
  EMPTY_RECENT_AGENT_ACTIVITY,
  shouldPollRecentAgentActivity,
} from '@/lib/recent-agent-activity';
import type { AgentRunsResponse } from '@/lib/types';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';

/** Any ledger event may change the summary: a new run, a status flip, a prompt waiting on the user. */
const RECENT_AGENT_ACTIVITY_EVENT_TYPES = ['agent-run.event'] as const;
/** A run emits several timeline events per tool call; one fetch per burst is enough. */
const RECENT_AGENT_ACTIVITY_EVENT_DEBOUNCE_MS = 400;

interface UseRecentAgentActivityOptions {
  enabled?: boolean;
  limit?: number;
  /** Fallback poll period, used only while the server event stream is not connected. */
  pollIntervalMs?: number;
}

export function useRecentAgentActivity({
  enabled = true,
  limit = 6,
  pollIntervalMs = 4000,
}: UseRecentAgentActivityOptions = {}) {
  const [payload, setPayload] = useState<AgentRunsResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const requestSeqRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);

  const refresh = useCallback(async (options: { showRefreshing?: boolean } = {}) => {
    let showRefreshing = options.showRefreshing ?? true;
    if (!enabled) {
      requestSeqRef.current += 1;
      inFlightRef.current = false;
      queuedRefreshRef.current = false;
      setPayload(null);
      setError('');
      setLoading(false);
      setRefreshing(false);
      setLastCheckedAt(null);
      return;
    }
    if (inFlightRef.current) {
      // A server event that lands mid-request must not be lost: run once more afterwards.
      queuedRefreshRef.current = true;
      return;
    }

    inFlightRef.current = true;
    try {
      do {
        queuedRefreshRef.current = false;
        const requestSeq = requestSeqRef.current + 1;
        requestSeqRef.current = requestSeq;
        if (showRefreshing) setRefreshing(true);
        try {
          const next = await mindosClient.getAgentRuns({
            includeEvents: true,
            limit,
          });
          if (requestSeqRef.current !== requestSeq) return;
          setPayload(next);
          setError('');
          setLastCheckedAt(Date.now());
        } catch (activityError) {
          if (requestSeqRef.current !== requestSeq) return;
          setError(compactAgentActivityError(activityError));
        } finally {
          if (requestSeqRef.current === requestSeq) {
            setLoading(false);
            if (showRefreshing) setRefreshing(false);
          }
        }
        showRefreshing = false;
      } while (queuedRefreshRef.current);
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, limit]);

  useEffect(() => () => {
    requestSeqRef.current += 1;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      setError('');
      setLoading(false);
      setRefreshing(false);
      setLastCheckedAt(null);
      return;
    }
    setLoading(true);
    void refresh({ showRefreshing: false });
  }, [enabled, refresh]);

  const summary = useMemo(
    () => (enabled ? buildRecentAgentActivity(payload, { limit }) : EMPTY_RECENT_AGENT_ACTIVITY),
    [enabled, limit, payload],
  );
  const summaryRef = useRef(summary);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  useEventDrivenRefresh({
    enabled,
    eventTypes: RECENT_AGENT_ACTIVITY_EVENT_TYPES,
    refresh: () => refresh({ showRefreshing: false }),
    debounceMs: RECENT_AGENT_ACTIVITY_EVENT_DEBOUNCE_MS,
    fallbackPollMs: pollIntervalMs,
    // The fallback poll keeps the old gate: only while a run is active or waiting on the user.
    shouldPoll: () => shouldPollRecentAgentActivity(summaryRef.current),
  });

  return {
    summary,
    loading,
    refreshing,
    error,
    lastCheckedAt,
    refresh,
  };
}
