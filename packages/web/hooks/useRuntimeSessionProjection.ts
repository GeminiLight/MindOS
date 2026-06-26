'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentRuntimeIdentity,
  RuntimeSessionProjection,
  RuntimeSessionProjectionsPayload,
} from '@/lib/types';

interface UseRuntimeSessionProjectionOptions {
  visible: boolean;
  runtime: AgentRuntimeIdentity | null | undefined;
  refreshMs?: number;
}

export function useRuntimeSessionProjection({
  visible,
  runtime,
  refreshMs = 3500,
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
    if (!enabled || refreshMs <= 0) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, refreshMs);
    return () => window.clearInterval(timer);
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
