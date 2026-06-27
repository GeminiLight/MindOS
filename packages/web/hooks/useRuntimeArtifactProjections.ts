'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentRuntimeArtifactProjection,
  AgentRuntimeArtifactProjectionsPayload,
} from '@/lib/types';

interface RuntimeArtifactProjectionsState {
  payload: AgentRuntimeArtifactProjectionsPayload | null;
  projections: AgentRuntimeArtifactProjection[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArtifactIndex(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.supported === 'boolean' &&
    typeof value.status === 'string' &&
    value.owner === 'mindos' &&
    typeof value.summary === 'string' &&
    typeof value.recordCount === 'number' &&
    Array.isArray(value.recentArtifacts);
}

function isArtifactProjection(value: unknown): value is AgentRuntimeArtifactProjection {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.runtimeId === 'string' &&
    typeof value.runtimeName === 'string' &&
    typeof value.runtimeKind === 'string' &&
    typeof value.runtimeStatus === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.outputKinds) &&
    Array.isArray(value.reviewableOutputKinds) &&
    Array.isArray(value.nativeHandoffTargets) &&
    isRecord(value.nativeReview) &&
    isArtifactIndex(value.artifactIndex) &&
    isRecord(value.rollback) &&
    isRecord(value.branchPr) &&
    Array.isArray(value.reasons);
}

function parseRuntimeArtifactProjectionsPayload(value: unknown): AgentRuntimeArtifactProjectionsPayload {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.projections)) {
    throw new Error('Invalid runtime artifact projection payload.');
  }

  return {
    schemaVersion: 1,
    projections: value.projections.filter(isArtifactProjection),
  };
}

export function useRuntimeArtifactProjections(input: { visible: boolean }): RuntimeArtifactProjectionsState {
  const { visible } = input;
  const [payload, setPayload] = useState<AgentRuntimeArtifactProjectionsPayload | null>(null);
  const [loading, setLoading] = useState(visible);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const forceRef = useRef(false);

  const refresh = useCallback(() => {
    forceRef.current = true;
    setRefreshSeq((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!visible) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const isForce = forceRef.current;
    forceRef.current = false;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetch(`/api/agent-runtimes/artifact-projections${isForce ? '?force=1' : ''}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Runtime artifact projections load failed (${response.status}).`);
        return response.json();
      })
      .then((value) => {
        if (cancelled) return;
        setPayload(parseRuntimeArtifactProjectionsPayload(value));
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setPayload(null);
        setError(err instanceof Error && err.message ? err.message : 'Runtime artifact projections load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshSeq, visible]);

  const projections = useMemo(() => payload?.projections ?? [], [payload]);

  return {
    payload,
    projections,
    loading,
    error,
    refresh,
  };
}
