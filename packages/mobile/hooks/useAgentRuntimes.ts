import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mindosClient } from '@/lib/api-client';
import { useConnectionStore } from '@/lib/connection-store';
import {
  buildRuntimeCompanionOptions,
  buildRuntimeCompanionSummary,
  compactRuntimeError,
} from '@/lib/agent-runtime-companion';
import type { AgentRuntimesResponse } from '@/lib/types';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';

/** MCP installs and restarts change which runtimes are ready; skills and sync do not. */
const AGENT_RUNTIMES_EVENT_TYPES = ['mcp.changed'] as const;
const AGENT_RUNTIMES_EVENT_DEBOUNCE_MS = 500;

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
  const active = enabled && connectionStatus === 'connected' && !!serverUrl;

  const load = useCallback(async ({ force = false, silent = false }: { force?: boolean; silent?: boolean } = {}) => {
    if (!active) {
      setResponse(null);
      setError('');
      setLastCheckedAt(null);
      hasLoadedRef.current = false;
      return;
    }

    setError('');
    const firstLoad = !hasLoadedRef.current;
    if (!silent) {
      setLoading(firstLoad);
      setRefreshing(!firstLoad);
    }
    try {
      const next = await mindosClient.getAgentRuntimes({ force });
      setResponse(next);
      setLastCheckedAt(Date.now());
      hasLoadedRef.current = true;
    } catch (runtimeError) {
      setError(compactRuntimeError(runtimeError));
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

  useEventDrivenRefresh({
    enabled: active,
    eventTypes: AGENT_RUNTIMES_EVENT_TYPES,
    // Background updates must not animate the pull-to-refresh control.
    refresh: () => load({ force: true, silent: true }),
    debounceMs: AGENT_RUNTIMES_EVENT_DEBOUNCE_MS,
  });

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
