'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getServerEventsState, subscribeServerEvents } from '@/lib/server-events';
import type {
  AgentRuntimeIdentity,
  RuntimeSessionProjection,
  RuntimeSessionProjectionsPayload,
} from '@/lib/types';

/**
 * Safety refresh cadence, applied only while the `/api/events` stream is not
 * connected and the tab is visible. A connected tab refreshes on turn
 * boundaries (`agent-run.event`) and on `runtime.changed` instead, so an idle
 * Chat panel issues no session-projection requests at all.
 */
export const RUNTIME_SESSION_PROJECTION_FALLBACK_POLL_MS = 30_000;

/** Ledger events that change what the session projection shows; tool and text deltas inside a turn do not. */
const TURN_BOUNDARY_EVENT_TYPES = new Set(['run_started', 'run_completed', 'run_failed', 'run_canceled']);

interface UseRuntimeSessionProjectionOptions {
  visible: boolean;
  runtime: AgentRuntimeIdentity | null | undefined;
  /** Fallback poll interval while the event stream is down; `0` disables the fallback. */
  refreshMs?: number;
}

export function useRuntimeSessionProjection({
  visible,
  runtime,
  refreshMs = RUNTIME_SESSION_PROJECTION_FALLBACK_POLL_MS,
}: UseRuntimeSessionProjectionOptions) {
  const [projections, setProjections] = useState<RuntimeSessionProjection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const runtimeId = runtime?.id;
  const runtimeKind = runtime?.kind;
  const enabled = visible && runtimeKind === 'acp' && Boolean(runtimeId);

  const refresh = useCallback(async () => {
    if (!enabled || !runtimeId) {
      setProjections([]);
      setLoading(false);
      setError(null);
      return;
    }

    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);
    try {
      const params = new URLSearchParams({ runtime: runtimeId });
      const res = await fetch(`/api/agent-runtimes/session-projections?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Runtime session projection failed (${res.status}).`);
      const payload = await res.json() as Partial<RuntimeSessionProjectionsPayload>;
      const next = Array.isArray(payload.projections) ? payload.projections : [];
      if (seqRef.current === seq) {
        setProjections(next);
        setError(null);
      }
    } catch (err) {
      if (seqRef.current === seq) {
        setProjections([]);
        setError(err instanceof Error && err.message ? err.message : 'Runtime session projection failed.');
      }
    } finally {
      if (seqRef.current === seq) setLoading(false);
    }
  }, [enabled, runtimeId]);

  useEffect(() => {
    if (!enabled) {
      setProjections([]);
      setLoading(false);
      setError(null);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribeRuns = subscribeServerEvents('agent-run.event', (event) => {
      if (TURN_BOUNDARY_EVENT_TYPES.has(event.event.type)) void refresh();
    });
    const unsubscribeRuntime = subscribeServerEvents('runtime.changed', () => {
      void refresh();
    });
    const unsubscribeReady = subscribeServerEvents('ready', (event) => {
      // A gap in the event log means boundaries may have been missed.
      if (event.resync) void refresh();
    });
    const timer = refreshMs > 0
      ? window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (getServerEventsState() === 'connected') return;
        void refresh();
      }, refreshMs)
      : null;
    return () => {
      unsubscribeRuns();
      unsubscribeRuntime();
      unsubscribeReady();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [enabled, refresh, refreshMs]);

  const selectedProjection = useMemo(() => {
    if (!runtime) return null;
    return projections.find((projection) => (
      projection.runtimeId === runtime.id
      || projection.runtimeKind === runtime.kind
    )) ?? projections[0] ?? null;
  }, [projections, runtime]);

  return {
    projections,
    selectedProjection,
    loading,
    error,
    refresh,
  };
}
