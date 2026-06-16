import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { mindosClient } from '@/lib/api-client';
import {
  buildRecentAgentActivity,
  compactAgentActivityError,
  EMPTY_RECENT_AGENT_ACTIVITY,
  shouldPollRecentAgentActivity,
} from '@/lib/recent-agent-activity';
import type { AgentRunsResponse } from '@/lib/types';

interface UseRecentAgentActivityOptions {
  enabled?: boolean;
  limit?: number;
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
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  const requestSeqRef = useRef(0);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (options: { showRefreshing?: boolean } = {}) => {
    const showRefreshing = options.showRefreshing ?? true;
    if (!enabled) {
      requestSeqRef.current += 1;
      inFlightRef.current = false;
      setPayload(null);
      setError('');
      setLoading(false);
      setRefreshing(false);
      setLastCheckedAt(null);
      return;
    }
    if (inFlightRef.current) return;

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    inFlightRef.current = true;
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
      inFlightRef.current = false;
    }
  }, [enabled, limit]);

  useEffect(() => () => {
    requestSeqRef.current += 1;
  }, []);

  useEffect(() => {
    function handleAppStateChange(nextState: AppStateStatus) {
      setAppActive(nextState === 'active');
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
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

  useEffect(() => {
    if (!enabled || !appActive || pollIntervalMs <= 0) return undefined;
    if (!shouldPollRecentAgentActivity(summary)) return undefined;

    const timer = setInterval(() => {
      void refresh({ showRefreshing: false });
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [appActive, enabled, pollIntervalMs, refresh, summary]);

  return {
    summary,
    loading,
    refreshing,
    error,
    lastCheckedAt,
    refresh,
  };
}
