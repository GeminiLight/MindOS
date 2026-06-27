'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentRuntimeCatalogEntry,
  AgentRuntimeCatalogPayload,
  AgentRuntimeDescriptor,
} from '@/lib/types';

interface RuntimeCatalogState {
  catalog: AgentRuntimeCatalogPayload | null;
  entries: AgentRuntimeCatalogEntry[];
  runtimes: AgentRuntimeDescriptor[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface RuntimeCatalogResponse {
  runtimes: AgentRuntimeDescriptor[];
  catalog: AgentRuntimeCatalogPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeDescriptor(value: unknown): value is AgentRuntimeDescriptor {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.status === 'string' &&
    isRecord(value.capabilities) &&
    isRecord(value.lifecycle) &&
    isRecord(value.compatibility);
}

function isRuntimeCatalogEntry(value: unknown): value is AgentRuntimeCatalogEntry {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.runtimeId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.category === 'string' &&
    typeof value.status === 'string' &&
    typeof value.adapter === 'string' &&
    Array.isArray(value.aliases) &&
    isRecord(value.owners) &&
    isRecord(value.capabilitySummary) &&
    isRecord(value.diagnostics);
}

function isRuntimeCatalogPayload(value: unknown): value is AgentRuntimeCatalogPayload {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.generatedAt === 'string' &&
    isRecord(value.summary) &&
    Array.isArray(value.entries);
}

function parseRuntimeCatalogResponse(value: unknown): RuntimeCatalogResponse {
  if (!isRecord(value) || !isRuntimeCatalogPayload(value.catalog) || !Array.isArray(value.runtimes)) {
    throw new Error('Invalid runtime catalog payload.');
  }

  const entries = value.catalog.entries.filter(isRuntimeCatalogEntry);
  return {
    runtimes: value.runtimes.filter(isRuntimeDescriptor),
    catalog: {
      ...value.catalog,
      entries,
    },
  };
}

export function useRuntimeCatalog(input: { visible: boolean }): RuntimeCatalogState {
  const { visible } = input;
  const [payload, setPayload] = useState<RuntimeCatalogResponse | null>(null);
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

    fetch(`/api/agent-runtimes${isForce ? '?force=1' : ''}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Runtime catalog load failed (${response.status}).`);
        return response.json();
      })
      .then((value) => {
        if (cancelled) return;
        setPayload(parseRuntimeCatalogResponse(value));
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setPayload(null);
        setError(err instanceof Error && err.message ? err.message : 'Runtime catalog load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshSeq, visible]);

  const entries = useMemo(() => payload?.catalog.entries ?? [], [payload]);

  return {
    catalog: payload?.catalog ?? null,
    entries,
    runtimes: payload?.runtimes ?? [],
    loading,
    error,
    refresh,
  };
}
