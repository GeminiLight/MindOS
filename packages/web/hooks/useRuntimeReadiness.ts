'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AgentPermissionMode,
  AgentRuntimeReadinessPayload,
  AgentRuntimeReadinessProjection,
} from '@/lib/types';

interface RuntimeReadinessState {
  readinessByRuntimeId: Record<string, AgentRuntimeReadinessProjection>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeReadinessProjection(value: unknown): value is AgentRuntimeReadinessProjection {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.runtimeId === 'string' &&
    typeof value.runtimeName === 'string' &&
    typeof value.runtimeKind === 'string' &&
    typeof value.overallStatus === 'string' &&
    Array.isArray(value.gaps);
}

function parseRuntimeReadinessPayload(value: unknown): AgentRuntimeReadinessPayload {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.projections)) {
    throw new Error('Invalid runtime readiness payload.');
  }
  return {
    schemaVersion: 1,
    requestedPermissionMode: value.requestedPermissionMode as AgentPermissionMode,
    projections: value.projections.filter(isRuntimeReadinessProjection),
  };
}

function indexRuntimeReadiness(
  projections: AgentRuntimeReadinessProjection[],
): Record<string, AgentRuntimeReadinessProjection> {
  const index: Record<string, AgentRuntimeReadinessProjection> = {};
  for (const projection of projections) {
    index[projection.runtimeId] = projection;
    if (!index[projection.runtimeKind]) {
      index[projection.runtimeKind] = projection;
    }
  }
  return index;
}

export function useRuntimeReadiness(input: {
  visible: boolean;
  permissionMode: AgentPermissionMode;
}): RuntimeReadinessState {
  const { visible, permissionMode } = input;
  const [payload, setPayload] = useState<AgentRuntimeReadinessPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);

  const refresh = useCallback(() => {
    setRefreshSeq((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!visible) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ permissionMode });
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/agent-runtimes/readiness?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Runtime readiness load failed (${response.status}).`);
        return response.json();
      })
      .then((value) => {
        if (cancelled) return;
        setPayload(parseRuntimeReadinessPayload(value));
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setPayload(null);
        setError(err instanceof Error && err.message ? err.message : 'Runtime readiness load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [permissionMode, refreshSeq, visible]);

  const readinessByRuntimeId = useMemo(
    () => indexRuntimeReadiness(payload?.projections ?? []),
    [payload],
  );

  return {
    readinessByRuntimeId,
    loading,
    error,
    refresh,
  };
}
