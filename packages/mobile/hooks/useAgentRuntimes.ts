import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mindosClient } from '@/lib/api-client';
import { useConnectionStore } from '@/lib/connection-store';
import {
  buildRuntimeCompanionOptions,
  buildRuntimeCompanionSummary,
  compactRuntimeError,
} from '@/lib/agent-runtime-companion';
import type { AgentRuntimesResponse } from '@/lib/types';

interface UseAgentRuntimesOptions {
  enabled?: boolean;
}

export function useAgentRuntimes({ enabled = true }: UseAgentRuntimesOptions = {}) {
  const connectionStatus = useConnectionStore((state) => state.status);
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const [response, setResponse] = useState<AgentRuntimesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!enabled || connectionStatus !== 'connected' || !serverUrl) {
      setResponse(null);
      setError('');
      setLastCheckedAt(null);
      hasLoadedRef.current = false;
      return;
    }

    setError('');
    const firstLoad = !hasLoadedRef.current;
    setLoading(firstLoad);
    setRefreshing(!firstLoad);
    try {
      const next = await mindosClient.getAgentRuntimes({ force });
      setResponse(next);
      setLastCheckedAt(Date.now());
      hasLoadedRef.current = true;
    } catch (runtimeError) {
      setError(compactRuntimeError(runtimeError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [connectionStatus, enabled, serverUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => buildRuntimeCompanionSummary(response), [response]);
  const options = useMemo(() => buildRuntimeCompanionOptions(response), [response]);

  return {
    response,
    summary,
    options,
    loading,
    refreshing,
    error,
    lastCheckedAt,
    refresh: () => load({ force: true }),
  };
}
